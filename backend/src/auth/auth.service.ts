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
import { isDemoEmail, isFamily, isStaff } from '../common/roles.js';
import { normalizePkPhone } from '../common/phone.js';
import type { OtpPurpose, Role } from '../generated/prisma/enums.js';
import type { ChangePasswordDto, RegisterParentDto, ResetPasswordDto, StepUpDto, UpdateMeDto } from './auth.dto.js';

const userInclude = {
  school: { select: { id: true, name: true, city: true, board: true, joinCode: true, address: true, phone: true, logoUrl: true, profileCompletedAt: true, suspendedAt: true } },
  teacherProfile: { select: { status: true, rejectReason: true } },
  student: { include: { section: { include: { schoolClass: true } } } },
  claims: { orderBy: { createdAt: 'desc' as const }, take: 1, include: { section: { include: { schoolClass: true } } } },
  guardians: { select: { id: true } },
  _count: { select: { passkeys: true } },
} as const;

export type LoginMethod = 'password' | 'google' | 'phone' | 'passkey' | 'email';

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

  async uniqueJoinCode(name: string) {
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

  /** An email used for a family sign-up that was never verified is released after the code expires. */
  async releaseUnverified(email: string) {
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (!u || u.emailVerified || Date.now() - u.createdAt.getTime() < env.otpTtlMinutes * 60_000) return;
    if (!isFamily(u.role)) return; // invited staff stay until the principal / super admin removes them
    await this.prisma.emailOtp.deleteMany({ where: { email } });
    await this.prisma.user.delete({ where: { id: u.id } });
  }

  /**
   * The only public sign-up: one Parent / Student account (read-only). Email is verified with a code before
   * anything else works; the mobile number (optional) can be used to sign in with the password too.
   */
  async registerParent(dto: RegisterParentDto) {
    await this.releaseUnverified(dto.email);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw new ConflictException('An account with this email already exists. Log in instead.');
    const phone = dto.phone ? normalizePkPhone(dto.phone) : null;
    if (dto.phone && !phone) throw new BadRequestException('Enter a Pakistani mobile number like 0300 1234567');
    if (phone) {
      const other = await this.prisma.user.findUnique({ where: { phoneE164: phone } });
      if (other && !other.emailVerified && isFamily(other.role) && Date.now() - other.createdAt.getTime() > env.otpTtlMinutes * 60_000) await this.prisma.user.delete({ where: { id: other.id } });
      else if (other) throw new ConflictException('This mobile number already has an account. Log in instead.');
    }
    await this.assertGoodPassword(dto.password, [dto.email, dto.name]);
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, phone: dto.phone ?? null, phoneE164: phone, role: 'PARENT', passwordHash: await this.hash(dto.password) },
    });
    await this.audit.record({ actorId: user.id, actorRole: 'PARENT', action: 'family.signup', entity: 'user', entityId: user.id });
    await this.issueOtp(user.email!, user.name, 'VERIFY_EMAIL');
    return { email: user.email, requiresVerification: true };
  }

  private link(path: string, params: Record<string, string>) {
    const base = env.appUrl.replace(/\/+$/, '');
    return `${base}${path}?${new URLSearchParams(params).toString()}`;
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
    if (purpose === 'LOGIN_CODE' || purpose === 'STEP_UP') await this.mail.loginCode(email, name, code, this.link('/email-code', { email, code }), purpose === 'LOGIN_CODE' ? 'login' : 'step-up');
    else if (purpose !== 'PHONE_LOGIN') await this.mail.sendOtp(email, name, code, purpose === 'VERIFY_EMAIL' ? 'verify' : purpose === 'DEVICE_CONFIRM' ? 'device' : 'reset', this.link('/verify', { email, code }));
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
   * Password sign-in, for Parent / Student accounts only (email OR mobile number + password).
   * Staff (super admin, principal, teacher) never use a password: they get an emailed code instead.
   * Returns a session, or a challenge when a second step is needed (authenticator app / new-device code).
   */
  async login(identifier: { email?: string; phone?: string }, password: string, device: DeviceInfo = {}) {
    const phone = identifier.phone ? normalizePkPhone(identifier.phone) : null;
    if (!identifier.email && identifier.phone && !phone) throw new BadRequestException('Enter your email, or a Pakistani mobile number like 0300 1234567');
    const user = identifier.email
      ? await this.prisma.user.findUnique({ where: { email: identifier.email } })
      : phone
        ? await this.prisma.user.findUnique({ where: { phoneE164: phone } })
        : null;
    if (!user && !identifier.email && !phone) throw new BadRequestException('Enter your email or mobile number');
    if (user && isStaff(user.role)) {
      throw new ForbiddenException({ message: 'Principals, teachers and LaalPen admins do not use a password. Choose “Staff” and sign in with the code we email you, Google or a passkey.', code: 'STAFF_USE_EMAIL_CODE' });
    }
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new HttpException({ message: `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'} or reset your password.`, code: 'ACCOUNT_LOCKED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) {
      if (user) await this.countFailedLogin(user.id, device.ip);
      throw new UnauthorizedException(identifier.email ? 'Email or password is incorrect' : 'Mobile number or password is incorrect');
    }
    // the right password also turns passkey sign-in back on for family accounts
    if (user.failedLogins || user.passkeyBlockedAt) await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, passkeyFailures: 0, passkeyBlockedAt: null } });
    if (!user.isActive) throw new ForbiddenException('Your account is disabled. Please contact your school.');
    await this.assertSchoolActive(user);
    if (!user.emailVerified) {
      if (user.email) await this.issueOtp(user.email, user.name, 'VERIFY_EMAIL').catch(() => undefined);
      throw new ForbiddenException({ message: 'Please verify your email first. We sent you a code.', code: 'EMAIL_NOT_VERIFIED', email: user.email });
    }
    return this.secondStep(user, device, 'password');
  }

  /** Staff of a suspended school (and its students) cannot sign in. Parents may have children in other schools. */
  async assertSchoolActive(user: { role: string; schoolId: string | null }) {
    if (!user.schoolId || user.role === 'SUPER_ADMIN' || user.role === 'PARENT') return;
    const school = await this.prisma.school.findUnique({ where: { id: user.schoolId }, select: { suspendedAt: true } });
    if (school?.suspendedAt) throw new ForbiddenException({ message: 'This school is paused on LaalPen. Please contact LaalPen support.', code: 'SCHOOL_SUSPENDED' });
  }

  // ---------- staff: emailed one-time code (no passwords) ----------

  /**
   * Sends a sign-in code (and a one-tap link) to a staff email. The answer is the same whether or not the
   * email belongs to staff (no account enumeration). Demo-school accounts (no mailbox) get the code on screen.
   */
  async emailCodeStart(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { school: { select: { suspendedAt: true } } } });
    const res: { ok: true; email: string; demoCode?: string } = { ok: true, email: maskEmail(email) };
    if (!user || !isStaff(user.role) || !user.isActive || (user.role !== 'SUPER_ADMIN' && user.school?.suspendedAt)) return res;
    try {
      const code = await this.issueOtp(email, user.name, 'LOGIN_CODE');
      if (isDemoEmail(email)) res.demoCode = code;
    } catch (e) {
      // asked again within a few seconds: the code already sent is still valid (same answer either way)
      if (!(e instanceof HttpException && e.getStatus() === HttpStatus.TOO_MANY_REQUESTS)) throw e;
    }
    return res;
  }

  /** Checks the emailed code (single use, expires, max 5 tries), then signs in. Also proves the email (invites). */
  async emailCodeVerify(email: string, code: string, device: DeviceInfo = {}) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !isStaff(user.role)) throw new BadRequestException('Code expired, please request a new one');
    await this.consumeOtp(email, 'LOGIN_CODE', code);
    if (!user.isActive) throw new ForbiddenException('Your account is disabled. Please contact your school.');
    await this.assertSchoolActive(user);
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true, passkeyFailures: 0, passkeyBlockedAt: null, failedLogins: 0, lockedUntil: null } });
    await this.audit.record({ schoolId: user.schoolId, actorId: user.id, actorRole: user.role, action: 'login.email-code', entity: 'user', entityId: user.id, ip: device.ip });
    return this.secondStep(user, device, 'email');
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
    if (method === 'password' && env.deviceConfirmRoles.includes(user.role) && device.deviceId && user.email && !env.deviceConfirmSkipDomains.includes(user.email.split('@')[1]?.toLowerCase() ?? '')) {
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

  /**
   * Google sign-in (Firebase verifies the Google email). Staff: only an account that the super admin /
   * principal already created — Google never creates staff. Family: signs in, or with signup=true creates
   * a Parent / Student account (its email is already verified by Google).
   */
  async googleLogin(idToken: string, device: DeviceInfo = {}, signup = false) {
    const g = await this.firebase.verifyGoogleToken(idToken);
    const user = await this.prisma.user.findUnique({ where: { email: g.email } });
    if (!user) {
      if (!signup) {
        throw new NotFoundException({
          message: 'No LaalPen account uses this Google email. Staff: ask your principal to add you. Parents and students: create an account first.',
          code: 'ACCOUNT_NOT_FOUND',
        });
      }
      const created = await this.prisma.user.create({
        data: { email: g.email, name: (g.name || g.email.split('@')[0]).slice(0, 80), role: 'PARENT', emailVerified: true, firebaseUid: g.uid },
      });
      await this.audit.record({ actorId: created.id, actorRole: 'PARENT', action: 'family.signup-google', entity: 'user', entityId: created.id, ip: device.ip });
      await this.security.rememberDevice(created.id, device, 'google');
      return this.session(created.id, device, 'google');
    }
    if (!user.isActive) throw new ForbiddenException('Your account is disabled. Please contact your school.');
    await this.assertSchoolActive(user);
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
    if (user && !isStaff(user.role)) await this.issueOtp(email, user.name, 'RESET_PASSWORD').catch(() => undefined);
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new BadRequestException('Incorrect code');
    if (isStaff(user.role)) throw new BadRequestException({ message: 'Staff accounts have no password. Sign in with the code we email you.', code: 'STAFF_USE_EMAIL_CODE' });
    await this.assertGoodPassword(dto.password, [dto.email, user.name]);
    await this.consumeOtp(dto.email, 'RESET_PASSWORD', dto.code);
    // the emailed code also re-enables passkey sign-in after failed tries
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.hash(dto.password), emailVerified: true, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null, passkeyFailures: 0, passkeyBlockedAt: null } });
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
    if (dto.password && user.passwordHash && !isStaff(user.role)) ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok && dto.code) ok = (await this.security.checkTotp(userId, dto.code)) || (await this.security.useBackupCode(userId, dto.code));
    if (!ok && dto.idToken) ok = (await this.firebase.verifyGoogleToken(dto.idToken).catch(() => null))?.email === user.email;
    if (!ok && dto.emailCode && user.email) ok = await this.consumeOtp(user.email, 'STEP_UP', dto.emailCode).then(() => true, () => false);
    if (!ok) throw new BadRequestException('That did not match. Try again.');
    await this.prisma.session.update({ where: { id: sessionId }, data: { stepUpAt: new Date() } });
    return { ok: true, validMinutes: env.stepUpMinutes };
  }

  /** Staff confirm a sensitive action with an emailed code (they have no password). */
  async stepUpEmailStart(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.email) throw new BadRequestException('This account has no email');
    try {
      const code = await this.issueOtp(user.email, user.name, 'STEP_UP');
      return { ok: true, email: maskEmail(user.email), ...(isDemoEmail(user.email) ? { demoCode: code } : {}) };
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === HttpStatus.TOO_MANY_REQUESTS) return { ok: true, email: maskEmail(user.email) };
      throw e;
    }
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
    if (isStaff(user.role)) throw new ForbiddenException({ message: 'Staff accounts have no password: you sign in with an emailed code, Google or a passkey.', code: 'STAFF_USE_EMAIL_CODE' });
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
      mfaSetupRequired: u.role === 'PRINCIPAL' && env.requireAdmin2fa && !u.totpEnabledAt && !(u._count?.passkeys > 0) && !isDemoEmail(u.email),
      staff: isStaff(u.role),
      usesPassword: !isStaff(u.role),
      hasPassword: !!u.passwordHash,
      passkeyBlocked: !!u.passkeyBlockedAt,
      school: u.school
        ? {
            id: u.school.id,
            name: u.school.name,
            city: u.school.city,
            board: u.school.board,
            joinCode: u.role === 'PRINCIPAL' || u.role === 'TEACHER' ? u.school.joinCode : undefined,
            address: u.school.address,
            phone: u.school.phone,
            logoUrl: u.school.logoUrl,
            profileComplete: !!u.school.profileCompletedAt,
            suspended: !!u.school.suspendedAt,
          }
        : null,
      teacher: u.role === 'TEACHER' ? { status: u.teacherProfile?.status ?? 'PROFILE_INCOMPLETE', rejectReason: u.teacherProfile?.rejectReason ?? null } : null,
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
