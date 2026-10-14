import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bootApp } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/** Phase A security: admin authenticator app, backup codes, new-device checks and alerts, lockout, panic link. */
describe('Security — 2FA, devices, lockout', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaService;
  let admin: Record<string, string>;
  let secret = '';
  let backup: string[] = [];
  const prev = { ...process.env };

  beforeAll(async () => {
    process.env.REQUIRE_ADMIN_2FA = 'true';
    process.env.DEVICE_CONFIRM_ROLES = 'TEACHER';
    ({ app, mail, prisma } = await bootApp());
    await api(app).post('/api/auth/register').send({ schoolName: 'Safe Haven School', name: 'Principal', email: 'boss@haven.test', password: 'Haven-Garden-91' }).expect(201);
    await prisma.user.update({ where: { email: 'boss@haven.test' }, data: { emailVerified: true } });
  });
  afterAll(async () => {
    process.env.REQUIRE_ADMIN_2FA = prev.REQUIRE_ADMIN_2FA;
    process.env.DEVICE_CONFIRM_ROLES = prev.DEVICE_CONFIRM_ROLES;
    await app.close();
  });

  it('an admin without an authenticator app can sign in but cannot open school data', async () => {
    const r = await api(app).post('/api/auth/login').send({ email: 'boss@haven.test', password: 'Haven-Garden-91', deviceId: 'phone-1', deviceName: 'Tecno Spark' });
    expect(r.status).toBe(200);
    expect(r.body.user.mfaSetupRequired).toBe(true);
    admin = { authorization: `Bearer ${r.body.accessToken}` };
    const blocked = await api(app).get('/api/admin/dashboard').set(admin);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MFA_SETUP_REQUIRED');
    await api(app).get('/api/auth/me').set(admin).expect(200); // setup screens still work
  });

  it('sets up the authenticator app with a QR code and gets 10 backup codes', async () => {
    const setup = await api(app).post('/api/auth/2fa/setup').set(admin);
    expect(setup.status).toBe(200);
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\/LaalPen/);
    expect(setup.body.qrSvg).toContain('<svg');
    secret = setup.body.secret;
    await api(app).post('/api/auth/2fa/enable').set(admin).send({ code: '000000' }).expect(400);
    const ok = await api(app).post('/api/auth/2fa/enable').set(admin).send({ code: await generate({ secret }) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    backup = ok.body.backupCodes;
    expect(backup).toHaveLength(10);
    expect(ok.body.user).toMatchObject({ twoFactor: true, mfaSetupRequired: false });
    await api(app).get('/api/admin/dashboard').set(admin).expect(200);
    const db = await prisma.user.findUniqueOrThrow({ where: { email: 'boss@haven.test' } });
    expect(db.totpSecretEnc).not.toContain(secret); // stored encrypted
    expect(mail.outbox.some((m) => m.to === 'boss@haven.test' && m.subject.includes('Two-step sign-in is on'))).toBe(true);
  });

  it('admins must keep 2FA on', async () => {
    await api(app).post('/api/auth/2fa/disable').set(admin).send({ code: await generate({ secret }) }).expect(403);
  });

  it('login now asks for the authenticator code; a backup code works once', async () => {
    const step1 = await api(app).post('/api/auth/login').send({ email: 'boss@haven.test', password: 'Haven-Garden-91', deviceId: 'phone-1' });
    expect(step1.body).toMatchObject({ mfaRequired: true, kind: 'TOTP' });
    expect(step1.body.accessToken).toBeUndefined();
    await api(app).post('/api/auth/login/verify').send({ challengeId: step1.body.challengeId, code: '123456' }).expect(400);
    const ok = await api(app).post('/api/auth/login/verify').send({ challengeId: step1.body.challengeId, code: await generate({ secret }), deviceId: 'phone-1' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    // the same challenge cannot be used twice
    await api(app).post('/api/auth/login/verify').send({ challengeId: step1.body.challengeId, code: await generate({ secret }) }).expect(400);

    const again = await api(app).post('/api/auth/login').send({ email: 'boss@haven.test', password: 'Haven-Garden-91', deviceId: 'phone-1' });
    await api(app).post('/api/auth/login/verify').send({ challengeId: again.body.challengeId, code: backup[0] }).expect(200);
    const third = await api(app).post('/api/auth/login').send({ email: 'boss@haven.test', password: 'Haven-Garden-91', deviceId: 'phone-1' });
    await api(app).post('/api/auth/login/verify').send({ challengeId: third.body.challengeId, code: backup[0] }).expect(400); // used up
  });

  it('a teacher on a new device must confirm an emailed code; known devices sign in directly', async () => {
    await api(app).post('/api/admin/teachers').set(admin).send({ name: 'Rabia Teacher', email: 'rabia@haven.test', password: 'Blue-Window-55' }).expect(201);
    const first = await api(app).post('/api/auth/login').send({ email: 'rabia@haven.test', password: 'Blue-Window-55', deviceId: 'tab-1', deviceName: 'Samsung Tab' });
    expect(first.body.accessToken).toBeTruthy(); // the first device of a new account is trusted
    const second = await api(app).post('/api/auth/login').send({ email: 'rabia@haven.test', password: 'Blue-Window-55', deviceId: 'phone-x', deviceName: 'Unknown phone' });
    expect(second.body).toMatchObject({ mfaRequired: true, kind: 'EMAIL_DEVICE', email: 'ra***@haven.test' });
    const code = [...mail.outbox].reverse().find((m) => m.to === 'rabia@haven.test' && m.subject.includes('confirm your new sign-in'))!.code!;
    const ok = await api(app).post('/api/auth/login/verify').send({ challengeId: second.body.challengeId, code, deviceId: 'phone-x' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(mail.outbox.some((m) => m.to === 'rabia@haven.test' && m.subject.includes('New sign-in'))).toBe(true);
    const third = await api(app).post('/api/auth/login').send({ email: 'rabia@haven.test', password: 'Blue-Window-55', deviceId: 'phone-x' });
    expect(third.body.accessToken).toBeTruthy();
    const devices = await api(app).get('/api/auth/devices').set({ authorization: `Bearer ${third.body.accessToken}` });
    expect(devices.body.map((d: any) => d.label).sort()).toEqual(['Samsung Tab', 'Unknown phone']);
  });

  it('locks an account after too many wrong passwords and tells the owner', async () => {
    for (let i = 0; i < 10; i++) await api(app).post('/api/auth/login').send({ email: 'rabia@haven.test', password: `wrong-${i}` }).expect(401);
    const locked = await api(app).post('/api/auth/login').send({ email: 'rabia@haven.test', password: 'Blue-Window-55' });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(mail.outbox.some((m) => m.to === 'rabia@haven.test' && m.subject.includes('locked'))).toBe(true);
    await prisma.user.update({ where: { email: 'rabia@haven.test' }, data: { lockedUntil: null } });
  });

  it('"this wasn\'t me" link signs every device out', async () => {
    const login = await api(app).post('/api/auth/login').send({ email: 'rabia@haven.test', password: 'Blue-Window-55', deviceId: 'tab-1' });
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'rabia@haven.test' } });
    const { SecurityService } = await import('../src/auth/security.service.js');
    const url = new URL(app.get(SecurityService).panicUrl(u.id));
    const res = await api(app).get(`${url.pathname}${url.search}`);
    expect(res.text).toContain('Every device was signed out');
    await api(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
    const forged = await api(app).get(`${url.pathname}${url.search.replace(/sig=[^&]+/, 'sig=nope')}`);
    expect(forged.text).toContain('expired');
  });

  it('a password reset still needs the authenticator code when 2FA is on', async () => {
    await api(app).post('/api/auth/forgot-password').send({ email: 'boss@haven.test' }).expect(200);
    const code = [...mail.outbox].reverse().find((m) => m.to === 'boss@haven.test' && m.code)!.code!;
    const r = await api(app).post('/api/auth/reset-password').send({ email: 'boss@haven.test', code, password: 'Haven-River-33' });
    expect(r.body).toMatchObject({ mfaRequired: true, kind: 'TOTP' });
    expect(r.body.accessToken).toBeUndefined();
  });
});
