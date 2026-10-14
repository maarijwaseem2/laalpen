import { createHash, randomBytes, randomInt } from 'node:crypto';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 48) => randomBytes(bytes).toString('base64url');
export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const tempPassword = () => `Lp-${randomBytes(4).toString('hex')}`;
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Short code students type to find their school, e.g. "ALN-4821". */
export function makeJoinCode(schoolName: string) {
  const letters = (schoolName.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'SCH').toUpperCase().padEnd(3, 'X');
  return `${letters}-${String(randomInt(0, 10_000)).padStart(4, '0')}`;
}
export const normalizeCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '');
