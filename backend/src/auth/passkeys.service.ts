import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransport as AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { env } from '../config/env.js';
import { AuthService } from './auth.service.js';
import { isStaff } from '../common/roles.js';
import { SecurityService, type DeviceInfo } from './security.service.js';

const TTL = 5 * 60_000;

/**
 * Passkeys: sign in with the phone's fingerprint / face, Windows Hello or a security key.
 * They cannot be phished (bound to this site) and count as two-step sign-in on their own.
 */
@Injectable()
export class PasskeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly security: SecurityService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private async challenge(purpose: 'register' | 'login', challenge: string, userId: string | null) {
    await this.prisma.webauthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return this.prisma.webauthnChallenge.create({ data: { purpose, challenge, userId, expiresAt: new Date(Date.now() + TTL) } });
  }

  private async useChallenge(id: string, purpose: 'register' | 'login', userId?: string) {
    const c = await this.prisma.webauthnChallenge.findUnique({ where: { id } });
    if (!c || c.purpose !== purpose || c.usedAt || c.expiresAt < new Date() || (userId && c.userId !== userId)) throw new BadRequestException('This request expired. Try again.');
    const used = await this.prisma.webauthnChallenge.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw new BadRequestException('This request expired. Try again.');
    return c;
  }

  async list(userId: string) {
    const rows = await this.prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, backedUp: p.backedUp }));
  }

  async remove(userId: string, id: string) {
    const p = await this.prisma.passkey.findFirst({ where: { id, userId } });
    if (!p) throw new NotFoundException('Passkey not found');
    await this.prisma.passkey.delete({ where: { id } });
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.audit.record({ schoolId: u.schoolId, actorId: userId, action: 'passkey.removed', entity: 'user', entityId: userId });
    return { ok: true };
  }

  // ---------- add a passkey (signed in) ----------

  async registerOptions(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { passkeys: true } });
    const options = await generateRegistrationOptions({
      rpName: 'LaalPen',
      rpID: env.webauthnRpId,
      userName: user.email ?? user.phoneE164 ?? user.id,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: user.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    const c = await this.challenge('register', options.challenge, userId);
    return { challengeId: c.id, options };
  }

  async registerVerify(userId: string, challengeId: string, response: RegistrationResponseJSON, name?: string) {
    const c = await this.useChallenge(challengeId, 'register', userId);
    let v;
    try {
      v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: env.webauthnOrigins, expectedRPID: env.webauthnRpId, requireUserVerification: false });
    } catch (e) {
      throw new BadRequestException(`Passkey not accepted: ${(e as Error).message}`);
    }
    if (!v.verified || !v.registrationInfo) throw new BadRequestException('Passkey not accepted');
    const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
    if (await this.prisma.passkey.findUnique({ where: { credentialId: credential.id } })) throw new BadRequestException('This passkey is already added');
    const p = await this.prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? response.response.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: name?.slice(0, 60) || 'Passkey',
      },
    });
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.audit.record({ schoolId: u.schoolId, actorId: userId, action: 'passkey.added', entity: 'user', entityId: userId });
    if (u.email) await this.mail.securityAlert(u.email, u.name, 'A passkey was added to your account', [`“${p.name}” can now sign in to your LaalPen account.`, 'If this was not you, sign out everywhere and change your password.'], this.security.panicUrl(u.id)).catch(() => undefined);
    return { id: p.id, name: p.name };
  }

  // ---------- sign in with a passkey ----------

  async loginOptions(email?: string) {
    const user = email ? await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() }, include: { passkeys: true } }) : null;
    const options = await generateAuthenticationOptions({
      rpID: env.webauthnRpId,
      userVerification: 'preferred',
      // unknown email: same answer shape (no account enumeration); the browser offers its saved passkeys
      allowCredentials: user?.passkeys.map((p) => ({ id: p.credentialId, transports: p.transports as AuthenticatorTransportFuture[] })) ?? [],
    });
    const c = await this.challenge('login', options.challenge, null);
    return { challengeId: c.id, options };
  }

  async loginVerify(challengeId: string, response: AuthenticationResponseJSON, device: DeviceInfo) {
    const c = await this.useChallenge(challengeId, 'login');
    const pk = await this.prisma.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
    if (!pk) throw new UnauthorizedException('This passkey is not registered with LaalPen');
    if (pk.user.passkeyBlockedAt) {
      throw new ForbiddenException({
        message: isStaff(pk.user.role)
          ? 'Passkey sign-in is paused after too many failed tries. Sign in with the code we email you to turn it back on.'
          : 'Passkey sign-in is paused after too many failed tries. Sign in with your password (or reset it by email) to turn it back on.',
        code: 'PASSKEY_BLOCKED',
      });
    }
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response,
        expectedChallenge: c.challenge,
        expectedOrigin: env.webauthnOrigins,
        expectedRPID: env.webauthnRpId,
        credential: { id: pk.credentialId, publicKey: new Uint8Array(pk.publicKey), counter: Number(pk.counter), transports: pk.transports as AuthenticatorTransportFuture[] },
        requireUserVerification: false,
      });
    } catch (e) {
      await this.failed(pk.user, device);
      throw new UnauthorizedException(`Passkey sign-in failed: ${(e as Error).message}`);
    }
    if (!v.verified) {
      await this.failed(pk.user, device);
      throw new UnauthorizedException('Passkey sign-in failed');
    }
    if (!pk.user.isActive) throw new UnauthorizedException('Your account is disabled. Please contact your school.');
    await this.auth.assertSchoolActive(pk.user);
    await this.prisma.passkey.update({ where: { id: pk.id }, data: { counter: BigInt(v.authenticationInfo.newCounter), lastUsedAt: new Date() } });
    if (pk.user.passkeyFailures) await this.prisma.user.update({ where: { id: pk.userId }, data: { passkeyFailures: 0 } });
    await this.security.rememberDevice(pk.userId, device, 'passkey');
    await this.audit.record({ schoolId: pk.user.schoolId, actorId: pk.userId, actorRole: pk.user.role, action: 'login.passkey', entity: 'user', entityId: pk.userId, ip: device.ip });
    // a passkey is already two factors (the device + its fingerprint/PIN): no extra code
    return this.auth.session(pk.userId, device, 'passkey', true);
  }

  /**
   * A failed passkey sign-in. After MAX_PASSKEY_FAILURES in a row passkey sign-in is paused, the owner gets a
   * security email, and only an email code (staff) or the password / emailed reset (family) turns it back on.
   */
  private async failed(user: { id: string; name: string; email: string | null; schoolId: string | null; role: string }, device: DeviceInfo) {
    const u = await this.prisma.user.update({ where: { id: user.id }, data: { passkeyFailures: { increment: 1 } } });
    await this.audit.record({ schoolId: user.schoolId, actorId: user.id, actorRole: user.role, action: 'login.passkey-failed', entity: 'user', entityId: user.id, ip: device.ip });
    if (u.passkeyFailures < env.maxPasskeyFailures) return;
    const blocked = await this.prisma.user.updateMany({ where: { id: user.id, passkeyBlockedAt: null }, data: { passkeyBlockedAt: new Date(), passkeyFailures: 0 } });
    if (!blocked.count) return;
    await this.audit.record({ schoolId: user.schoolId, actorId: user.id, actorRole: user.role, action: 'passkey.blocked', entity: 'user', entityId: user.id, ip: device.ip });
    if (user.email) {
      await this.mail
        .securityAlert(user.email, user.name, `${env.maxPasskeyFailures} failed passkey sign-ins`, [
          `Someone tried to sign in to your LaalPen account with a passkey ${env.maxPasskeyFailures} times and failed${device.ip ? ` (IP ${device.ip})` : ''}.`,
          isStaff(user.role)
            ? 'Passkey sign-in is paused. Next time, sign in with the code we email you; that turns passkeys back on.'
            : 'Passkey sign-in is paused. Sign in with your password (or reset it by email) to turn passkeys back on.',
        ], this.security.panicUrl(user.id))
        .catch(() => undefined);
    }
  }
}
