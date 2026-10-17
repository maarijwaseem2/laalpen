import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bootApp, lastCodeFor } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/** Family (Parent / Student) accounts: the only public sign-up, password sign-in by email or phone. */
describe('Authentication — family accounts', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaService;
  const email = 'mother@family.test';
  const lastCode = () => lastCodeFor(mail, email);

  beforeAll(async () => {
    ({ app, mail, prisma } = await bootApp());
  });
  afterAll(() => app.close());

  it('the public school sign-up is closed (schools are added by the LaalPen super admin)', async () => {
    const r = await api(app).post('/api/auth/register').send({ schoolName: 'Test School', name: 'Owner', email: 'owner@school.test', password: 'Secret-Mango-42' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SCHOOL_SIGNUP_CLOSED');
    expect(await prisma.school.count({ where: { name: 'Test School' } })).toBe(0);
  });

  it('rejects weak passwords and bad phone numbers with a clear message', async () => {
    const r = await api(app).post('/api/auth/signup').send({ name: 'Ammi', email, password: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/8 to 128 characters/);
    const common = await api(app).post('/api/auth/signup').send({ name: 'Ammi', email, password: 'pakistan123' });
    expect(common.body.code).toBe('WEAK_PASSWORD');
    const phone = await api(app).post('/api/auth/signup').send({ name: 'Ammi', email, phone: '12345', password: 'Secret-Mango-42' });
    expect(phone.status).toBe(400);
  });

  it('signs up (name, email, phone, password) and emails a 6-digit code with a verify link', async () => {
    const r = await api(app).post('/api/auth/signup').send({ name: 'Ammi Jaan', email: 'Mother@Family.test', phone: '0300-7654321', password: 'Secret-Mango-42' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toEqual({ email, requiresVerification: true });
    expect(lastCode()).toMatch(/^\d{6}$/);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.role).toBe('PARENT');
    expect(u.phoneE164).toBe('+923007654321');
  });

  it('blocks a duplicate email or phone', async () => {
    await api(app).post('/api/auth/signup').send({ name: 'Someone', email, password: 'Secret-Mango-42' }).expect(409);
    await api(app).post('/api/auth/signup').send({ name: 'Someone', email: 'other@family.test', phone: '+92 300 7654321', password: 'Secret-Mango-42' }).expect(409);
  });

  it('does not allow login before the email is verified', async () => {
    await prisma.emailOtp.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const r = await api(app).post('/api/auth/login').send({ email, password: 'Secret-Mango-42' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects a wrong code, then verifies with the right one and is signed in', async () => {
    const bad = await api(app).post('/api/auth/verify-email').send({ email, code: '000000' === lastCode() ? '111111' : '000000' });
    expect(bad.status).toBe(400);
    const r = await api(app).post('/api/auth/verify-email').send({ email, code: lastCode() });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.user).toMatchObject({ role: 'PARENT', staff: false, usesPassword: true });
  });

  it('logs in with email OR mobile number, reads /me, refreshes (rotating) and logs out', async () => {
    const byPhone = await api(app).post('/api/auth/login').send({ phone: '0300 7654321', password: 'Secret-Mango-42' });
    expect(byPhone.status, JSON.stringify(byPhone.body)).toBe(200);
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
    await api(app).post('/api/auth/login').send({ phone: '03007654321', password: 'Wrong1234' }).expect(401);
    await api(app).post('/api/auth/login').send({ password: 'Wrong1234' }).expect(400);
    await api(app).get('/api/auth/me').expect(401);
    await api(app).get('/api/auth/me').set('authorization', 'Bearer nonsense').expect(401);
  });

  it('resets a forgotten password with an emailed code', async () => {
    await prisma.emailOtp.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await api(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    await api(app).post('/api/auth/forgot-password').send({ email: 'nobody@x.test' }).expect(200); // no account enumeration
    const r = await api(app).post('/api/auth/reset-password').send({ email, code: lastCode(), password: 'New-Mango-Tree-42' });
    expect(r.status).toBe(200);
    await api(app).post('/api/auth/login').send({ email, password: 'Secret-Mango-42' }).expect(401);
    await api(app).post('/api/auth/login').send({ email, password: 'New-Mango-Tree-42' }).expect(200);
  });

  it('Google: signs in an existing account; a new Google email needs an explicit family sign-up (never staff)', async () => {
    const ok = await api(app).post('/api/auth/google').send({ idToken: `test-google:${email}` });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(email);
    const missing = await api(app).post('/api/auth/google').send({ idToken: 'test-google:stranger@x.test' });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await prisma.user.count({ where: { email: 'stranger@x.test' } })).toBe(0);
    const signup = await api(app).post('/api/auth/google').send({ idToken: 'test-google:newmum@x.test', signup: true });
    expect(signup.status).toBe(200);
    expect(signup.body.user).toMatchObject({ role: 'PARENT', emailVerified: true });
  });

  it('updates profile and changes password', async () => {
    const login = await api(app).post('/api/auth/login').send({ email, password: 'New-Mango-Tree-42' });
    const auth = { authorization: `Bearer ${login.body.accessToken}` };
    const upd = await api(app).patch('/api/auth/me').set(auth).send({ name: 'Ammi Sahiba', phone: '0300-1234567' });
    expect(upd.body.name).toBe('Ammi Sahiba');
    await api(app).post('/api/auth/change-password').set(auth).send({ currentPassword: 'wrong', newPassword: 'Another-Guava-77' }).expect(400);
    await api(app).post('/api/auth/change-password').set(auth).send({ currentPassword: 'New-Mango-Tree-42', newPassword: 'Another-Guava-77' }).expect(200);
  });
});
