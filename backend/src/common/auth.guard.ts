import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ALLOW_SETUP, ALLOW_WITHOUT_MFA, IS_PUBLIC, ROLES, STEP_UP, type AuthUser } from './decorators.js';
import { isDemoEmail } from './roles.js';
import type { Role } from '../generated/prisma/enums.js';
import { env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Global guard: checks the Bearer token, that the account and its session (device) are still active,
 * the route's allowed roles, mandatory 2FA for admins and recent re-authentication for sensitive actions.
 * The school (tenant) always comes from the verified token, never from the request body.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Please log in');

    let payload: { sub: string; role: Role; schoolId: string | null; email: string | null; sid?: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: env.jwtAccessSecret });
    } catch {
      throw new UnauthorizedException('Session expired, please log in again');
    }
    const live = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        isActive: true, totpEnabledAt: true, role: true, schoolId: true, email: true, _count: { select: { passkeys: true } },
        school: { select: { suspendedAt: true, profileCompletedAt: true } },
        teacherProfile: { select: { status: true } },
        sessions: payload.sid ? { where: { id: payload.sid }, select: { revokedAt: true, stepUpAt: true } } : false },
    });
    if (!live?.isActive) throw new UnauthorizedException('Your account is disabled. Please contact your school.');
    const session = (live.sessions as { revokedAt: Date | null; stepUpAt: Date | null }[] | undefined)?.[0];
    if (payload.sid && (!session || session.revokedAt)) throw new UnauthorizedException('This device was signed out. Please log in again.');
    // the role and school always come from the database, so a changed role takes effect at once
    const user: AuthUser = { id: payload.sub, role: live.role, schoolId: live.schoolId, email: payload.email, sid: payload.sid, ip: req.ips?.length ? req.ips[0] : req.ip };
    req.user = user;

    // a school paused by the LaalPen super admin: its staff and students are locked out (parents may have other schools)
    if (live.school?.suspendedAt && live.role !== 'PARENT' && live.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException({ message: 'This school is paused on LaalPen. Please contact LaalPen support.', code: 'SCHOOL_SUSPENDED' });
    }
    const allowWithoutMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets);
    // principals see a whole school's data: they must have the authenticator app (or a passkey) before anything else
    if (live.role === 'PRINCIPAL' && env.requireAdmin2fa && !live.totpEnabledAt && !live._count.passkeys && !isDemoEmail(live.email) && !allowWithoutMfa) {
      throw new ForbiddenException({ message: 'Set up the authenticator app to protect your school data.', code: 'MFA_SETUP_REQUIRED' });
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException('You do not have access to this page');
    }
    const setupRoute = allowWithoutMfa || this.reflector.getAllAndOverride<boolean>(ALLOW_SETUP, targets);
    // first sign-in: the principal completes the school profile before anything else
    if (live.role === 'PRINCIPAL' && !live.school?.profileCompletedAt && !setupRoute) {
      throw new ForbiddenException({ message: 'Complete your school profile first.', code: 'SCHOOL_PROFILE_REQUIRED' });
    }
    // a teacher sees no student data until the principal approves their profile
    if (live.role === 'TEACHER' && (live.teacherProfile?.status ?? 'PROFILE_INCOMPLETE') !== 'APPROVED' && !setupRoute) {
      throw new ForbiddenException({ message: 'Your profile is waiting for the principal’s approval.', code: 'TEACHER_APPROVAL_REQUIRED' });
    }
    if (this.reflector.getAllAndOverride<boolean>(STEP_UP, targets)) {
      const fresh = session?.stepUpAt && Date.now() - session.stepUpAt.getTime() < env.stepUpMinutes * 60_000;
      if (!fresh) throw new ForbiddenException({ message: 'For your safety, confirm it is you first.', code: 'STEP_UP_REQUIRED' });
    }
    return true;
  }
}
