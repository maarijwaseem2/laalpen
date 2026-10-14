import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { env } from '../config/env.js';
import { sha256 } from '../common/util.js';
import type { ChallengeKind } from '../generated/prisma/enums.js';

const key = () => createHash('sha256').update(env.totpEncryptionKey).digest();

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptSecret(blob: string) {
  const [, iv, tag, enc] = blob.split(':');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

const backupHash = (userId: string, code: string) => sha256(`${userId}:backup:${code.replace(/[^a-z0-9]/gi, '').toLowerCase()}`);

export interface DeviceInfo {
  deviceId?: string;
  deviceName?: string;
  ip?: string;
}

/**
 * Authenticator-app 2FA (TOTP) with backup codes, known devices, login challenges and security emails.
 * Email codes are used only to confirm a NEW device for accounts without an authenticator app —
 * NIST SP 800-63B-4 says email is not a second factor, so it never replaces TOTP for admins.
 */
@Injectable()
export class SecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  deviceHash(userId: string, deviceId?: string) {
    return deviceId ? sha256(`${userId}:device:${deviceId}`) : null;
  }

  // ---------- TOTP ----------

  async startTotpSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { school: true } });
    if (user.totpEnabledAt) throw new BadRequestException('The authenticator app is already set up');
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: encryptSecret(secret) } });
    const uri = generateURI({ issuer: 'LaalPen', label: user.email ?? user.phoneE164 ?? user.name, secret });
    const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220, color: { dark: '#1B2A4A', light: '#FFFFFF' } });
    return { secret, uri, qrSvg };
  }

  async checkTotp(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecretEnc) return false;
    const token = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(token)) return false;
    try {
      const res = await verifyTotp({ secret: decryptSecret(user.totpSecretEnc), token, epochTolerance: 30 });
      return res.valid;
    } catch {
      return false;
    }
  }

  /** Turns 2FA on and returns 10 one-time backup codes (shown once). */
  async enableTotp(userId: string, code: string) {
    if (!(await this.checkTotp(userId, code))) throw new BadRequestException('That code is not right. Check the time on your phone and try the newest code.');
    const user = await this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } });
    const codes = await this.newBackupCodes(userId);
    if (user.email) await this.mail.securityAlert(user.email, user.name, 'Two-step sign-in is on', ['An authenticator app now protects your LaalPen account.'], this.panicUrl(userId));
    return { backupCodes: codes };
  }

  async disableTotp(userId: string, code: string, role: string) {
    if (role === 'ADMIN' && env.requireAdmin2fa) throw new ForbiddenException('Principals and admins must keep the authenticator app on');
    if (!(await this.checkTotp(userId, code)) && !(await this.useBackupCode(userId, code))) throw new BadRequestException('That code is not right');
    const user = await this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: null, totpSecretEnc: null } });
    await this.prisma.backupCode.deleteMany({ where: { userId } });
    if (user.email) await this.mail.securityAlert(user.email, user.name, 'Two-step sign-in was turned off', ['The authenticator app no longer protects your account.'], this.panicUrl(userId));
    return { ok: true };
  }

  async newBackupCodes(userId: string) {
    const codes = Array.from({ length: 10 }, () => {
      const raw = randomBytes(5).toString('hex');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await this.prisma.$transaction([
      this.prisma.backupCode.deleteMany({ where: { userId } }),
      this.prisma.backupCode.createMany({ data: codes.map((c) => ({ userId, codeHash: backupHash(userId, c) })) }),
    ]);
    return codes;
  }

  async useBackupCode(userId: string, code: string) {
    const used = await this.prisma.backupCode.updateMany({ where: { userId, codeHash: backupHash(userId, code), usedAt: null }, data: { usedAt: new Date() } });
    return used.count > 0;
  }

  // ---------- login challenges ----------

  async createChallenge(userId: string, kind: ChallengeKind, device: DeviceInfo, method: string) {
    const c = await this.prisma.loginChallenge.create({
      data: {
        userId,
        kind,
        method,
        deviceHash: this.deviceHash(userId, device.deviceId),
        deviceLabel: device.deviceName?.slice(0, 80),
        expiresAt: new Date(Date.now() + env.otpTtlMinutes * 60_000),
      },
    });
    return c.id;
  }

  /** Checks the code for a challenge; returns the user id on success. Max 5 tries per challenge. */
  async completeChallenge(challengeId: string, code: string, verifyEmailCode: (email: string, code: string) => Promise<void>) {
    const c = await this.prisma.loginChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
    if (!c || c.usedAt || c.expiresAt < new Date()) throw new BadRequestException('This sign-in expired. Please sign in again.');
    const counted = await this.prisma.loginChallenge.updateMany({ where: { id: c.id, attempts: { lt: 5 }, usedAt: null }, data: { attempts: { increment: 1 } } });
    if (!counted.count) throw new BadRequestException('Too many wrong codes. Please sign in again.');
    if (c.kind === 'TOTP') {
      const ok = (await this.checkTotp(c.userId, code)) || (await this.useBackupCode(c.userId, code));
      if (!ok) throw new BadRequestException('That code is not right');
    } else {
      await verifyEmailCode(c.user.email!, code);
    }
    const used = await this.prisma.loginChallenge.updateMany({ where: { id: c.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw new BadRequestException('This sign-in expired. Please sign in again.');
    return c;
  }

  // ---------- devices ----------

  async isKnownDevice(userId: string, deviceId?: string) {
    const h = this.deviceHash(userId, deviceId);
    if (!h) return false;
    return !!(await this.prisma.knownDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash: h } } }));
  }

  async hasAnyDevice(userId: string) {
    return (await this.prisma.knownDevice.count({ where: { userId } })) > 0;
  }

  /** Records the device; emails an alert when it is new (except the very first device of the account). */
  async rememberDevice(userId: string, device: DeviceInfo, method: string) {
    const h = this.deviceHash(userId, device.deviceId);
    if (!h) return;
    const existing = await this.prisma.knownDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash: h } } });
    if (existing) {
      await this.prisma.knownDevice.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), lastIp: device.ip } });
      return;
    }
    const first = !(await this.hasAnyDevice(userId));
    await this.prisma.knownDevice.create({ data: { userId, deviceHash: h, label: device.deviceName?.slice(0, 80), lastIp: device.ip } });
    if (first) return;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email) {
      await this.mail.securityAlert(
        user.email,
        user.name,
        'New sign-in to your account',
        [`A new device signed in${device.deviceName ? ` (${device.deviceName})` : ''} with ${method === 'google' ? 'Google' : 'your password'}${device.ip ? ` from IP ${device.ip}` : ''}.`],
        this.panicUrl(userId),
      );
    }
  }

  listDevices(userId: string) {
    return this.prisma.knownDevice.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' }, select: { id: true, label: true, lastIp: true, firstSeenAt: true, lastSeenAt: true } });
  }

  async forgetDevice(userId: string, id: string) {
    await this.prisma.knownDevice.deleteMany({ where: { id, userId } });
    return { ok: true };
  }

  // ---------- "this wasn't me" ----------

  panicUrl(userId: string) {
    const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
    const sig = createHmac('sha256', env.jwtAccessSecret).update(`panic:${userId}:${exp}`).digest('base64url');
    return `${env.publicApiUrl}/api/auth/secure-account?u=${encodeURIComponent(userId)}&exp=${exp}&sig=${sig}`;
  }

  verifyPanic(userId: string, exp: number, sig: string) {
    if (!userId || !exp || !sig || exp < Date.now() / 1000) return false;
    const want = Buffer.from(createHmac('sha256', env.jwtAccessSecret).update(`panic:${userId}:${exp}`).digest('base64url'));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  async secureAccount(userId: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'this-was-not-me' } });
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.knownDevice.deleteMany({ where: { userId } });
  }
}
