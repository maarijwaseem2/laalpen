import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/enums.js';

export interface AuthUser {
  id: string;
  role: Role;
  schoolId: string | null;
  email: string | null;
  /** session (device) id */
  sid?: string;
  ip?: string;
}

export const IS_PUBLIC = 'isPublic';
/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route works before an admin has set up the authenticator app (setup screens, profile, logout). */
export const ALLOW_WITHOUT_MFA = 'allowWithoutMfa';
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA, true);

/**
 * Route works while a principal has not finished the school profile, or a teacher is still waiting for the
 * principal's approval (setup screens, notifications, profile). Everything else is blocked until then.
 */
export const ALLOW_SETUP = 'allowSetup';
export const AllowSetup = () => SetMetadata(ALLOW_SETUP, true);

/** Sensitive action: the user must have re-entered a password / authenticator code in the last few minutes. */
export const STEP_UP = 'stepUp';
export const StepUp = () => SetMetadata(STEP_UP, true);

export const ROLES = 'roles';
/** Route is only for these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** The logged-in user from the JWT. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
