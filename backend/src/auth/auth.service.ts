import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { FirebaseService } from './firebase.service.js';
import { env } from '../config/env.js';
import { makeJoinCode, randomToken, sha256, sixDigitCode } from '../common/util.js';
import { AuditService } from '../audit/audit.service.js';
import { SecurityService, type DeviceInfo } from './security.service.js';
import { passwordProblem } from './passwords.js';
import type { OtpPurpose, Role } from '../generated/prisma/enums.js';
import type { ChangePasswordDto, RegisterSchoolDto, ResetPasswordDto, StepUpDto, UpdateMeDto } from './auth.dto.js';

const userInclude = {
  school: { select: { id: true, name: true, city: true, board: true, joinCode: true } },
  student: { include: { section: { include: { schoolClass: true } } } },
  claims: { orderBy: { createdAt: 'desc' as const }, take: 1, include: { section: { include: { schoolClass: true } } } },
  guardians: { select: { id: true } },
  _count: { select: { passkeys: true } },
} as const;

export type LoginMethod = 'password' | 'google' | 'phone' | 'passkey';

@Injectable()
export class AuthService {
  /** Called after an email is verified for the first time (claims module hooks in here). */
  readonly emailVerifiedHooks: ((userId: string) => Promise<void>)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly firebase: FirebaseService,
    private readonly security: SecurityService,
    private readonly audit: AuditService,
  ) {}

  /** Throws a friendly 400 when a password is too common, breached or contains the user's name/email. */
  async assertGoodPassword(password: string, context: string[] = []) {
    const problem = await passwordProblem(password, context);
    if (problem) throw new BadRequestException({ message: problem, code: 'WEAK_PASSWORD' });
  }

  private async uniqueJoinCode(name: string) {
    for (let i = 0; i < 20; i++) {
      const code = makeJoinCode(name);
      if (!(await this.prisma.school.findUnique({ where: { joinCode: code } }))) return code;
    }
    return `${makeJoinCode(name)}${Date.now().toString(36).slice(-2).toUpperCase()}`;
  }

  hash(password: string) {
    return bcrypt.hash(password, 10);
  }

  // ---------- registration & verification ----------

  /** An email used for a sign-up that was never verified is released after the code expires. */
  async releaseUnverified(email: string) {
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (!u || u.emailVerified || Date.now() - u.createdAt.getTime() < env.otpTtlMinutes * 60_000) return;
    await this.prisma.emailOtp.deleteMany({ where: { email } });
    if (u.role === 'ADMIN' && u.schoolId) {
      const others = await this.prisma.user.count({ where: { schoolId: u.schoolId, id: { not: u.id } } });
      if (!others) {
        await this.prisma.school.delete({ where: { id: u.schoolId } });
        return;
      }
    }
    if (u.role !== 'TEACHER') await this.prisma.user.delete({ where: { id: u.id } });
  }

  async registerSchool(dto: RegisterSchoolDto) {
    await this.releaseUnverified(dto.email);
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('An account with this email already exists');
    await this.assertGoodPassword(dto.password, [dto.email, dto.name, dto.schoolName]);
    const passwordHash = await this.hash(dto.password);
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        role: 'ADMIN',
        school: {
          create: {
            name: dto.schoolName,
            city: dto.city,
            board: dto.board,
            joinCode: await this.uniqueJoinCode(dto.schoolName),
            sessions: { create: { name: `${year}-${String((year + 1) % 100).padStart(2, '0')}`, startsOn: new Date(Date.UTC(year, 3, 1)), isCurrent: true } },
          },
        },
      },
    });
    await this.issueOtp(user.email!, user.name, 'VERIFY_EMAIL');
    return { email: user.email, requiresVerification: true };
  }

  async issueOtp(email: string, name: string, purpose: OtpPurpose) {
    const last = await this.prisma.emailOtp.findFirst({ where: { email, purpose }, orderBy: { createdAt: 'desc' } });
    if (last && !last.usedAt && Date.now() - last.createdAt.getTime() < 45_000) {
      throw new HttpException('Please wait a few seconds before requesting another code', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.prisma.emailOtp.updateMany({ where: { email, purpose, usedAt: null }, data: { usedAt: new Date() } });
    const code = sixDigitCode();
    await this.prisma.emailOtp.create({
      data: { email, purpose, codeHash: sha256(`${email}:${code}`), expiresAt: new Date(Date.now() + env.otpTtlMinutes * 60_000) },
    });
    if (purpose !== 'PHONE_LOGIN') await this.mail.sendOtp(email, name, code, purpose === 'VERIFY_EMAIL' ? 'verify' : purpose === 'DEVICE_CONFIRM' ? 'device' : 'reset');
    return code;
  }

  /** Checks a 6-digit code (email or phone). Attempts are counted atomically: max 5 per code. */
  async consumeOtp(target: string, purpose: OtpPurpose, code: string) {
    const otp = await this.prisma.emailOtp.findFirst({
      where: { email: target, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('Code expired, please request a new one');
    const counted = await this.prisma.emailOtp.updateMany({ where: { id: otp.id, attempts: { lt: 5 }, usedAt: null }, data: { attempts: { increment: 1 } } });
    if (!counted.count) throw new BadRequestException('Too many wrong attempts, please request a new code');
    if (otp.codeHash !== sha256(`${target}:${code}`)) throw new BadRequestException('Incorrect code');
    const used = await this.prisma.emailOtp.updateMany({ where: { id: otp.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw new BadRequestException('Code expired, please request a new one');
  }

  async verifyEmail(email: string, code: string, device: DeviceInfo = {}) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Account not found');
    await this.consumeOtp(email, 'VERIFY_EMAIL', code);
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    if (!user.emailVerified) for (const hook of this.emailVerifiedHooks) await hook(user.id);
    await this.security.rememberDevice(user.id, device, 'password');
    return this.session(user.id, device, 'password');
  }

  async resendOtp(email: string, purpose: OtpPurpose) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !(purpose === 'VERIFY_EMAIL' && user.emailVerified)) await this.issueOtp(email, user.name, purpose);
    return { ok: true };
  }

  // ---------- login ----------

  /**
   * Step 1 of sign-in. Returns a session, or a challenge when a second step is needed:
   * - TOTP: the account has an authenticator app (all admins);
   * - EMAIL_DEVICE: a teacher without an authenticator app signs in on a new device.
   */
  async login(email: string, password: string, device: DeviceInfo = {}) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new HttpException({ message: `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'} or reset your password.`, code: 'ACCOUNT_LOCKED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      if (user) await this.countFailedLogin(user.id, device.ip);
      throw new UnauthorizedException('Email or password is incorrect');
    }
    if (user.failedLogins) await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    if (!user.isActive) throw new ForbiddenException('Your account is disabled. Please contact your school.');
    if (!user.emailVerified) {
      await this.issueOtp(email, user.name, 'VERIFY_EMAIL').catch(() => undefined);
      throw new ForbiddenException({ message: 'Please verify your email first. We sent you a code.', code: 'EMAIL_NOT_VERIFIED' });
    }
    return this.secondStep(user, device, 'password');
  }

  /** Per-account throttling (OWASP): after N wrong passwords the account is locked for a while and the owner is told. */
  private async countFailedLogin(userId: string, ip?: string) {
    const u = await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: { increment: 1 } } });
    if (u.failedLogins >= env.maxFailedLogins) {
      await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + env.lockMinutes * 60_000) } });
      await this.audit.record({ schoolId: u.schoolId, actorId: u.id, action: 'account.locked', entity: 'user', entityId: u.id, ip });
      if (u.email) {
        await this.mail.securityAlert(u.email, u.name, 'Account locked for a few minutes', [
          `Someone typed a wrong password for your account ${env.maxFailedLogins} times, so sign-in is paused for ${env.lockMinutes} minutes.`,
          'If this was not you, reset your password from the sign-in screen.',
        ], this.security.panicUrl(u.id));
      }
    }
  }

  private async secondStep(user: { id: string; name: string; role: string; email: string | null; totpEnabledAt: Date | null }, device: DeviceInfo, method: LoginMethod) {
    if (user.totpEnabledAt) {
      const challengeId = await this.security.createChallenge(user.id, 'TOTP', device, method);
      return { mfaRequired: true, kind: 'TOTP' as const, challengeId };
    }
    if (method === 'password' && env.deviceConfirmRoles.includes(user.role) && device.deviceId && user.email) {
      const known = await this.security.isKnownDevice(user.id, device.deviceId);
      if (!known && (await this.security.hasAnyDevice(user.id))) {
        const challengeId = await this.security.createChallenge(user.id, 'EMAIL_DEVICE', device, method);
        // if a code was sent less than a minute ago the user can still use that one
        await this.issueOtp(user.email, user.name, 'DEVICE_CONFIRM').catch(() => undefined);
        return { mfaRequired: true, kind: 'EMAIL_DEVICE' as const, challengeId, email: maskEmail(user.email) };
      }
    }
    await this.security.rememberDevice(user.id, device, method);
    return this.session(user.id, device, method);
  }

  /** Step 2 of sign-in: authenticator / backup code, or the emailed new-device code. */
  async verifyLogin(challengeId: string, code: string, device: DeviceInfo = {}) {
    const c = await this.security.completeChallenge(challengeId, code, (email, otp) => this.consumeOtp(email, 'DEVICE_CONFIRM', otp));
    if (!c.user.isActive) throw new ForbiddenException('Your account is disabled. Please contact your school.');
    const d = { ...device, deviceName: device.deviceName ?? c.deviceLabel ?? undefined };
    await this.security.rememberDevice(c.userId, d, c.method);
    return this.session(c.userId, d, c.method as LoginMethod, true);
  }

  async googleLogin(idToken: string, device: DeviceInfo = {}) {
    const g = await this.firebase.verifyGoogleToken(idToken);
    const user = await this.prisma.user.findUnique({ where: { email: g.email } });
    if (!user) {
      throw new NotFoundException({
        message: 'No LaalPen account uses this Google email. Ask your school admin to add you, or register your school.',
        code: 'ACCOUNT_NOT_FOUND',
      });
    }
    if (!user.isActive) throw new ForbiddenException('Your account is disabled. Please contact your school.');
    if (!user.emailVerified) {
      // someone else may have registered this email without owning it: drop their password and sessions
      await this.prisma.user.update({ where: { id: user.id }, data: { firebaseUid: g.uid, emailVerified: true, passwordHash: null } });
      await this.revokeAll(user.id, 'google-takeover');
      for (const hook of this.emailVerifiedHooks) await hook(user.id);
    } else {
      await this.prisma.user.update({ where: { id: user.id }, data: { firebaseUid: g.uid } });
    }
    return this.secondStep(user, device, 'google');
  }

  // ---------- password reset ----------

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) await this.issueOtp(email, user.name, 'RESET_PASSWORD').catch(() => undefined);
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new BadRequestException('Incorrect code');
    await this.assertGoodPassword(dto.password, [dto.email, user.name]);
    await this.consumeOtp(dto.email, 'RESET_PASSWORD', dto.code);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.hash(dto.password), emailVerified: true, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await this.mail.securityAlert(dto.email, user.name, 'Your password was changed', ['Your LaalPen password was reset with an emailed code. All other devices were signed out.'], this.security.panicUrl(user.id));
    await this.revokeAll(user.id, 'password-reset');
    await this.audit.record({ schoolId: user.schoolId, actorId: user.id, action: 'password.reset', entity: 'user', entityId: user.id });
    if (user.totpEnabledAt) {
      // a reset email alone must not get past the authenticator app
      const challengeId = await this.security.createChallenge(user.id, 'TOTP', {}, 'password');
      return { mfaRequired: true, kind: 'TOTP' as const, challengeId };
    }
    return this.session(user.id);
  }

  // ---------- sessions & tokens ----------

  /**
   * Issues tokens. Each device gets a Session row; refresh tokens rotate inside it. A JWT carries the
   * session id, so "sign out this device" works immediately.
   */
  async session(userId: string, device: DeviceInfo = {}, method: LoginMethod = 'password', stepUp = false, existingSessionId?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude });
    const sessionId =
      existingSessionId ??
      (
        await this.prisma.session.create({
          data: { userId, deviceHash: this.security.deviceHash(userId, device.deviceId), deviceLabel: device.deviceName?.slice(0, 80), ip: device.ip, method, stepUpAt: new Date() },
        })
      ).id;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role as Role, schoolId: user.schoolId, email: user.email, sid: sessionId },
      { secret: env.jwtAccessSecret, expiresIn: env.jwtAccessTtl as never },
    );
    const refreshToken = randomToken();
    await this.prisma.refreshToken.create({
      data: { userId, sessionId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + env.refreshTtlDays * 86_400_000) },
    });
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  /** Rotation with reuse detection: a refresh token used twice means it was copied — the whole session ends. */
  async refresh(token: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true, session: true } });
    if (!row) throw new UnauthorizedException('Session expired, please log in again');
    if (row.rotatedAt) {
      if (row.sessionId) await this.revokeSession(row.sessionId, 'refresh-token-reuse');
      await this.audit.record({ schoolId: row.user.schoolId, actorId: row.userId, action: 'session.token-reuse', entity: 'session', entityId: row.sessionId ?? row.id });
      if (row.user.email) {
        await this.mail.securityAlert(row.user.email, row.user.name, 'We signed out a device', ['An old sign-in token was used again, which can mean it was copied. That device was signed out to protect your account.'], this.security.panicUrl(row.userId));
      }
      throw new UnauthorizedException('Session expired, please log in again');
    }
    if (row.revokedAt || row.expiresAt < new Date() || !row.user.isActive || row.session?.revokedAt) {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    const rotated = await this.prisma.refreshToken.updateMany({ where: { id: row.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: new Date(), revokedAt: new Date() } });
    if (!rotated.count) throw new UnauthorizedException('Session expired, please log in again');
    if (row.sessionId) await this.prisma.session.update({ where: { id: row.sessionId }, data: { lastSeenAt: new Date() } });
    return this.session(row.userId, {}, 'password', false, row.sessionId ?? undefined);
  }

  async logout(token: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (row?.sessionId) await this.revokeSession(row.sessionId, 'logout');
    else await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async revokeSession(sessionId: string, reason: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
    await this.prisma.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAll(userId: string, reason: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) }, data: { revokedAt: new Date(), revokeReason: reason } });
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { sessionId: { not: exceptSessionId } } : {}) }, data: { revokedAt: new Date() } });
  }

  async logoutAll(userId: string) {
    await this.revokeAll(userId, 'sign-out-everywhere');
    return { ok: true };
  }

  async listSessions(userId: string, currentSid?: string) {
    const rows = await this.prisma.session.findMany({ where: { userId, revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 50 });
    return rows.map((s) => ({ id: s.id, deviceLabel: s.deviceLabel, ip: s.ip, method: s.method, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === currentSid }));
  }

  async endSession(userId: string, sessionId: string) {
    const s = await this.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!s) throw new NotFoundException('Device not found');
    await this.revokeSession(sessionId, 'signed-out-by-user');
    return { ok: true };
  }

  /**
   * Step-up: prove it is really you (password, authenticator / backup code, or Google) before a
   * sensitive action. Valid for STEP_UP_MINUTES on this session only.
   */
  async stepUp(userId: string, sessionId: string | undefined, dto: StepUpDto) {
    if (!sessionId) throw new BadRequestException('Please sign in again');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let ok = false;
    if (dto.password && user.passwordHash) ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok && dto.code) ok = (await this.security.checkTotp(userId, dto.code)) || (await this.security.useBackupCode(userId, dto.code));
    if (!ok && dto.idToken) ok = (await this.firebase.verifyGoogleToken(dto.idToken).catch(() => null))?.email === user.email;
    if (!ok) throw new BadRequestException('That did not match. Try again.');
    await this.prisma.session.update({ where: { id: sessionId }, data: { stepUpAt: new Date() } });
    return { ok: true, validMinutes: env.stepUpMinutes };
  }

  // ---------- profile ----------

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude });
    return this.publicUser(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.prisma.user.update({ where: { id: userId }, data: dto });
    return this.me(userId);
  }

  async changePassword(userId: string, sessionId: string | undefined, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash) {
      // Google-only account: setting a first password needs no current password
    } else if (!dto.currentPassword || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.assertGoodPassword(dto.newPassword, [user.email ?? '', user.name]);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hash(dto.newPassword), passwordChangedAt: new Date() } });
    await this.revokeAll(userId, 'password-changed');
    await this.audit.record({ schoolId: user.schoolId, actorId: userId, action: 'password.changed', entity: 'user', entityId: userId });
    if (user.email) await this.mail.securityAlert(user.email, user.name, 'Your password was changed', ['Your LaalPen password was changed. All other devices were signed out.'], this.security.panicUrl(userId));
    void sessionId;
    return this.session(userId, {}, 'password', true); // fresh tokens for this device; every other device must log in again
  }

  publicUser(u: any) {
    const claim = u.claims?.[0];
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone ?? u.phoneE164 ?? null,
      role: u.role,
      avatarUrl: u.avatarUrl,
      emailVerified: u.emailVerified,
      twoFactor: !!u.totpEnabledAt,
      passkeys: u._count?.passkeys ?? 0,
      // a passkey also counts as two-step sign-in
      mfaSetupRequired: u.role === 'ADMIN' && env.requireAdmin2fa && !u.totpEnabledAt && !(u._count?.passkeys > 0),
      school: u.school ?? null,
      student: u.student
        ? {
            id: u.student.id,
            name: u.student.name,
            rollNo: u.student.rollNo,
            sectionId: u.student.sectionId,
            sectionName: u.student.section?.name,
            className: u.student.section?.schoolClass?.name,
            status: 'APPROVED' as const,
          }
        : null,
      // a student account not yet linked to the school roster
      claim:
        !u.student && u.role === 'STUDENT' && claim
          ? { id: claim.id, status: claim.status, rejectReason: claim.rejectReason, rollNo: claim.rollNo, className: claim.section?.schoolClass?.name, sectionName: claim.section?.name, sectionId: claim.sectionId }
          : null,
      parent: u.role === 'PARENT' ? { guardians: u.guardians?.length ?? 0 } : null,
    };
  }
}

function maskEmail(e: string) {
  const [name, domain] = e.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}
