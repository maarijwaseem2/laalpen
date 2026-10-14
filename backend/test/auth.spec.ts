import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bootApp } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

describe('Authentication', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaService;
  const email = 'owner@school.test';
  const lastCode = () => [...mail.outbox].reverse().find((m) => m.to === email && m.code)?.code;

  beforeAll(async () => {
    ({ app, mail, prisma } = await bootApp());
  });
  afterAll(() => app.close());

  it('rejects weak passwords with a clear message', async () => {
    const r = await api(app).post('/api/auth/register').send({ schoolName: 'Test School', name: 'Owner', email, password: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/8 to 128 characters/);
    const common = await api(app).post('/api/auth/register').send({ schoolName: 'Test School', name: 'Owner', email, password: 'pakistan123' });
    expect(common.status).toBe(400);
    expect(common.body.code).toBe('WEAK_PASSWORD');
  });

  it('registers a school and emails a 6-digit code', async () => {
    const r = await api(app).post('/api/auth/register').send({ schoolName: 'Test School', city: 'Karachi', name: 'Owner', email: 'Owner@School.test', password: 'Secret-Mango-42' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ email, requiresVerification: true });
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it('blocks a duplicate email', async () => {
    const r = await api(app).post('/api/auth/register').send({ schoolName: 'Another School', name: 'Someone', email, password: 'Secret-Mango-42' });
    expect(r.status).toBe(409);
  });

  it('does not allow login before the email is verified', async () => {
    await prisma.emailOtp.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const r = await api(app).post('/api/auth/login').send({ email, password: 'Secret-Mango-42' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects a wrong code, then verifies with the right one and logs in', async () => {
    const bad = await api(app).post('/api/auth/verify-email').send({ email, code: '000000' === lastCode() ? '111111' : '000000' });
    expect(bad.status).toBe(400);
    const r = await api(app).post('/api/auth/verify-email').send({ email, code: lastCode() });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.user.role).toBe('ADMIN');
    expect(r.body.user.school.name).toBe('Test School');
  });

  it('logs in, reads /me, refreshes (rotating) and logs out', async () => {
    const login = await api(app).post('/api/auth/login').send({ email, password: 'Secret-Mango-42' });
    expect(login.status).toBe(200);
    const me = await api(app).get('/api/auth/me').set('authorization', `Bearer ${login.body.accessToken}`);
    expect(me.body.email).toBe(email);

    const refreshed = await api(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(refreshed.status).toBe(200);
    const reuse = await api(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(reuse.status).toBe(401); // old refresh token is single-use

    await api(app).post('/api/auth/logout').send({ refreshToken: refreshed.body.refreshToken }).expect(200);
    await api(app).post('/api/auth/refresh').send({ refreshToken: refreshed.body.refreshToken }).expect(401);
  });

  it('rejects wrong passwords and missing tokens', async () => {
    await api(app).post('/api/auth/login').send({ email, password: 'Wrong1234' }).expect(401);
    await api(app).get('/api/auth/me').expect(401);
    await api(app).get('/api/auth/me').set('authorization', 'Bearer nonsense').expect(401);
  });

  it('resets a forgotten password with an emailed code', async () => {
    await api(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    await api(app).post('/api/auth/forgot-password').send({ email: 'nobody@x.test' }).expect(200); // no account enumeration
    const code = lastCode();
    const r = await api(app).post('/api/auth/reset-password').send({ email, code, password: 'New-Mango-Tree-42' });
    expect(r.status).toBe(200);
    await api(app).post('/api/auth/login').send({ email, password: 'Secret-Mango-42' }).expect(401);
    await api(app).post('/api/auth/login').send({ email, password: 'New-Mango-Tree-42' }).expect(200);
  });

  it('signs in with Google only when the email belongs to an account', async () => {
    const ok = await api(app).post('/api/auth/google').send({ idToken: `test-google:${email}` });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(email);
    const missing = await api(app).post('/api/auth/google').send({ idToken: 'test-google:stranger@x.test' });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('updates profile and changes password', async () => {
    const login = await api(app).post('/api/auth/login').send({ email, password: 'New-Mango-Tree-42' });
    const auth = { authorization: `Bearer ${login.body.accessToken}` };
    const upd = await api(app).patch('/api/auth/me').set(auth).send({ name: 'Principal Sahab', phone: '0300-1234567' });
    expect(upd.body.name).toBe('Principal Sahab');
    await api(app).post('/api/auth/change-password').set(auth).send({ currentPassword: 'wrong', newPassword: 'Another-Guava-77' }).expect(400);
    await api(app).post('/api/auth/change-password').set(auth).send({ currentPassword: 'New-Mango-Tree-42', newPassword: 'Another-Guava-77' }).expect(200);
  });
});
