import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Password rules from NIST SP 800-63B-4: no "must contain a symbol" rules and no forced changes;
 * instead, block very common and known-breached passwords. Passphrases are encouraged.
 */
const COMMON = new Set(
  `123456 123456789 12345678 password 12345 1234567 qwerty 111111 123123 abc123 1234567890 password1 000000 iloveyou
  1q2w3e4r 1qaz2wsx qwerty123 qwertyuiop 654321 666666 7777777 112233 121212 123321 asdfgh asdfghjkl zxcvbnm
  welcome welcome1 admin admin123 administrator letmein monkey dragon football baseball sunshine princess master
  passw0rd p@ssw0rd p@ssword password123 password12 pass1234 test1234 test123 changeme secret secret123 trustno1
  pakistan pakistan1 pakistan123 pakistan786 786786 786786786 allah786 bismillah bismillah1 lahore karachi islamabad
  lahore123 karachi123 cricket cricket1 imrankhan babarazam shahid afridi pakistanzindabad zindabad 03001234567
  student student1 student123 teacher teacher1 teacher123 school school1 school123 laalpen laalpen1 laalpen123
  principal principal1 abcd1234 abcdefgh aa123456 a1b2c3d4 11111111 22222222 88888888 99999999 12341234 123qwe
  qweasdzxc 1q2w3e4r5t zaq12wsx asd123 love123 lovely mylove fuckyou superman batman iloveu football1 india123
  hello123 hello1234 computer internet samsung nokia google facebook whatsapp mobile mobile123`.split(/\s+/).filter(Boolean),
);

/** Returns a problem message, or null when the password is acceptable. */
export async function passwordProblem(password: string, context: string[] = []): Promise<string | null> {
  if (password.length < 8) return 'Use at least 8 characters — a short sentence is easiest to remember';
  if (password.length > 128) return 'Use at most 128 characters';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password) || /^(0123456789|1234567890|abcdefgh)/.test(lower)) {
    return 'This password is too common. Try a short sentence like "meri chai thandi hai"';
  }
  for (const c of context) {
    const part = c.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '');
    if (part.length >= 4 && lower.includes(part)) return 'Do not use your name or email in the password';
  }
  if (await isBreached(password)) return 'This password appeared in a data breach. Please choose a different one';
  return null;
}

/**
 * Have I Been Pwned "range" API with k-anonymity: only the first 5 characters of the SHA-1 hash are sent.
 * If the service is unreachable we allow the password (fail open) — the common-password list still applies.
 */
export async function isBreached(password: string): Promise<boolean> {
  if (!env.breachedPasswordCheck) return false;
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'LaalPen' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const suffix = hash.slice(5);
    return (await res.text()).split('\n').some((line) => {
      const [h, count] = line.trim().split(':');
      return h === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
