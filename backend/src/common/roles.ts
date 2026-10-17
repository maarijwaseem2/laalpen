import { env } from '../config/env.js';

/** Staff never use passwords: they sign in with an emailed one-time code, a passkey or Google (existing account only). */
export const STAFF_ROLES = ['SUPER_ADMIN', 'PRINCIPAL', 'TEACHER'] as const;
/** The one public account type: a parent or the student themself (read-only). */
export const FAMILY_ROLES = ['PARENT', 'STUDENT'] as const;

export const isStaff = (role?: string | null) => !!role && (STAFF_ROLES as readonly string[]).includes(role);
export const isFamily = (role?: string | null) => !!role && (FAMILY_ROLES as readonly string[]).includes(role);

/** Shared demo school accounts (e.g. @laalpen.demo): no mailbox exists, so their sign-in code is shown on screen. */
export const isDemoEmail = (email?: string | null) => !!email && env.demoLoginDomains.includes(email.split('@')[1]?.toLowerCase() ?? '');
