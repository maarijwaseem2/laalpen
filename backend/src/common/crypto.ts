import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const key = (purpose: string) => createHash('sha256').update(`${purpose}:${env.dataEncryptionKey}`).digest();

/** AES-256-GCM for sensitive fields (B-Form numbers). */
export function encryptField(plain: string, purpose = 'field') {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(purpose), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptField(blob: string, purpose = 'field') {
  const [, iv, tag, enc] = blob.split(':');
  const d = createDecipheriv('aes-256-gcm', key(purpose), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

/** Short human code without look-alike characters (no 0/O, 1/I/L). */
export function humanCode(len = 8) {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
