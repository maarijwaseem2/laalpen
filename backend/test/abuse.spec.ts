import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bootApp, lastCodeFor, newSchool } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { sniffImage } from '../src/common/image-type.js';

/** Rate limits behind a CDN (real visitor IP from a header) and duplicate-request protection. */
describe('abuse protection', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let admin: Record<string, string>;

  beforeAll(async () => {
    process.env.CLIENT_IP_HEADER = 'cf-connecting-ip';
    ({ app, prisma, mail } = await bootApp());
    ({ auth: admin } = await newSchool(app, prisma, mail, { schoolName: 'Abuse School', email: 'admin@abuse.test' }));
    // a family (Parent / Student) account: the only kind that signs in with a password
    await api(app).post('/api/auth/signup').send({ name: 'Family Abuse', email: 'family@abuse.test', password: 'Secret-Mango-42' }).expect(201);
    await api(app).post('/api/auth/verify-email').send({ email: 'family@abuse.test', code: lastCodeFor(mail, 'family@abuse.test') }).expect(200);
  });
  afterAll(async () => {
    delete process.env.CLIENT_IP_HEADER;
    delete process.env.THROTTLE_IN_TESTS;
    await app.close();
  });

  it('login is limited per visitor IP (taken from the CDN header) and email: the 11th try in a minute gets 429', async () => {
    process.env.THROTTLE_IN_TESTS = 'true';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const r = await api(app).post('/api/auth/login').set('cf-connecting-ip', '203.0.113.7').send({ email: 'nobody@abuse.test', password: 'Wrong-Pass-1' });
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
      // a different visitor (another real IP) is not blocked by the first one
      const other = await api(app).post('/api/auth/login').set('cf-connecting-ip', '198.51.100.9').send({ email: 'nobody@abuse.test', password: 'Wrong-Pass-1' });
      expect(other.status).toBe(401);
    } finally {
      delete process.env.THROTTLE_IN_TESTS;
    }
  });

  it('staff email codes are rate limited: the 6th request (start) or 11th guess (verify) in a minute gets 429', async () => {
    process.env.THROTTLE_IN_TESTS = 'true';
    try {
      const starts: number[] = [];
      for (let i = 0; i < 6; i++) starts.push((await api(app).post('/api/auth/email-code/start').set('cf-connecting-ip', '203.0.113.21').send({ email: 'staff@abuse.test' })).status);
      expect(starts.slice(0, 5).every((s) => s === 200)).toBe(true);
      expect(starts[5]).toBe(429);
      const guesses: number[] = [];
      for (let i = 0; i < 11; i++) guesses.push((await api(app).post('/api/auth/email-code/verify').set('cf-connecting-ip', '203.0.113.22').send({ email: 'staff@abuse.test', code: String(100000 + i) })).status);
      expect(guesses.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(guesses[10]).toBe(429);
    } finally {
      delete process.env.THROTTLE_IN_TESTS;
    }
  });

  it('the visitor IP from the CDN header is what the audit log records', async () => {
    for (let i = 0; i < 10; i++) {
      await api(app).post('/api/auth/login').set('cf-connecting-ip', '203.0.113.50').send({ email: 'family@abuse.test', password: 'Wrong-Pass-9' });
    }
    const locked = await prisma.auditLog.findFirst({ where: { action: 'account.locked' }, orderBy: { createdAt: 'desc' } });
    expect(locked?.ip).toBe('203.0.113.50');
    await prisma.user.update({ where: { email: 'family@abuse.test' }, data: { lockedUntil: null, failedLogins: 0 } });
  });

  it('a create sent twice with the same Idempotency-Key runs once and the copy gets the same answer', async () => {
    const send = () => api(app).post('/api/admin/subjects').set(admin).set('Idempotency-Key', 'tap-123').send({ name: 'Geography' });
    const [a, b] = await Promise.all([send(), send()]); // double click: both at the same moment
    const c = await send(); // network retry a moment later
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(c.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(c.body.id).toBe(a.body.id);
    expect(c.headers['idempotent-replay']).toBe('true');
    expect(await prisma.subject.count({ where: { name: 'Geography' } })).toBe(1);
  });

  it('a failed request is not remembered, and a new key is a new request', async () => {
    const bad = await api(app).post('/api/admin/subjects').set(admin).set('Idempotency-Key', 'tap-bad').send({ name: '' });
    expect(bad.status).toBe(400);
    const ok = await api(app).post('/api/admin/subjects').set(admin).set('Idempotency-Key', 'tap-bad').send({ name: 'History' });
    expect(ok.status).toBe(201);
    const dup = await api(app).post('/api/admin/subjects').set(admin).set('Idempotency-Key', 'tap-other').send({ name: 'History' });
    expect(dup.status).toBe(409); // a genuinely new request still hits the normal duplicate rules
  });

  it('rejects malformed idempotency keys', async () => {
    const r = await api(app).post('/api/admin/subjects').set(admin).set('Idempotency-Key', 'x'.repeat(200)).send({ name: 'Art' });
    expect(r.status).toBe(400);
  });

  it('only real JPG / PNG / WEBP bytes count as a photo, whatever the file claims to be', () => {
    expect(sniffImage(Buffer.from('ffd8ffe000104a46494600010100', 'hex'))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))).toBe('image/png');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffImage(Buffer.from('MZ\x90\x00 program file....'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});
