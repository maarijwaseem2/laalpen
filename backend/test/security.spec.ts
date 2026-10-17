import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTeacher, api, bootApp, lastCodeFor, newSchool, staffCodeLogin } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/** Security: principal authenticator app, backup codes, staff email codes, new-device alerts, lockout, panic link. */
describe('Security — 2FA, devices, lockout', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaService;
  let admin: Record<string, string>;
  let secret = '';
  let backup: string[] = [];
  const prev = { ...process.env };
  const family = async (email: string) => {
    await api(app).post('/api/auth/signup').send({ name: 'Family Person', email, password: 'Blue-Window-55' }).expect(201);
    await api(app).post('/api/auth/verify-email').send({ email, code: lastCodeFor(mail, email) }).expect(200);
  };

  beforeAll(async () => {
    process.env.REQUIRE_ADMIN_2FA = 'true';
    process.env.DEVICE_CONFIRM_ROLES = 'TEACHER';
    ({ app, mail, prisma } = await bootApp());
    ({ auth: admin } = await newSchool(app, prisma, mail, { schoolName: 'Safe Haven School', email: 'boss@haven.test' }));
  });
  afterAll(async () => {
    process.env.REQUIRE_ADMIN_2FA = prev.REQUIRE_ADMIN_2FA;
    process.env.DEVICE_CONFIRM_ROLES = prev.DEVICE_CONFIRM_ROLES;
    await app.close();
  });

  it('a principal without an authenticator app or passkey can sign in but cannot open school data', async () => {
    const me = await api(app).get('/api/auth/me').set(admin).expect(200); // setup screens still work
    expect(me.body.mfaSetupRequired).toBe(true);
    const blocked = await api(app).get('/api/admin/dashboard').set(admin);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MFA_SETUP_REQUIRED');
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

  it('principals must keep 2FA on', async () => {
    await api(app).post('/api/auth/2fa/disable').set(admin).send({ code: await generate({ secret }) }).expect(403);
  });

  it('the email code is followed by the authenticator code; a backup code works once', async () => {
    const step1 = await staffCodeLogin(app, prisma, mail, 'boss@haven.test', { deviceId: 'phone-1' });
    expect(step1).toMatchObject({ mfaRequired: true, kind: 'TOTP' });
    expect(step1.accessToken).toBeUndefined();
    await api(app).post('/api/auth/login/verify').send({ challengeId: step1.challengeId, code: '123456' }).expect(400);
    const ok = await api(app).post('/api/auth/login/verify').send({ challengeId: step1.challengeId, code: await generate({ secret }), deviceId: 'phone-1' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    // the same challenge cannot be used twice
    await api(app).post('/api/auth/login/verify').send({ challengeId: step1.challengeId, code: await generate({ secret }) }).expect(400);

    const again = await staffCodeLogin(app, prisma, mail, 'boss@haven.test', { deviceId: 'phone-1' });
    await api(app).post('/api/auth/login/verify').send({ challengeId: again.challengeId, code: backup[0] }).expect(200);
    const third = await staffCodeLogin(app, prisma, mail, 'boss@haven.test', { deviceId: 'phone-1' });
    await api(app).post('/api/auth/login/verify').send({ challengeId: third.challengeId, code: backup[0] }).expect(400); // used up
  });

  it('a teacher signing in on a new device (with the emailed code) gets a new-sign-in alert; devices are listed', async () => {
    const t = await addTeacher(app, prisma, mail, admin, { name: 'Rabia Teacher', email: 'rabia@haven.test' });
    void t;
    await staffCodeLogin(app, prisma, mail, 'rabia@haven.test', { deviceId: 'tab-1', deviceName: 'Samsung Tab' });
    const before = mail.outbox.filter((m) => m.to === 'rabia@haven.test' && m.subject.includes('New sign-in')).length;
    const second = await staffCodeLogin(app, prisma, mail, 'rabia@haven.test', { deviceId: 'phone-x', deviceName: 'Unknown phone' });
    expect(second.accessToken).toBeTruthy(); // the emailed code already proves it is them
    expect(mail.outbox.filter((m) => m.to === 'rabia@haven.test' && m.subject.includes('New sign-in')).length).toBe(before + 1);
    const devices = await api(app).get('/api/auth/devices').set({ authorization: `Bearer ${second.accessToken}` });
    expect(devices.body.map((d: any) => d.label).sort()).toContain('Unknown phone');
  });

  it('staff can never sign in with a password, and wrong staff passwords do not lock the account', async () => {
    await prisma.user.update({ where: { email: 'rabia@haven.test' }, data: { passwordHash: '$2a$10$abcdefghijklmnopqrstuvC2xF8LxO8bQ1a6J0vZ1Gm3lP5mUVOa' } });
    for (let i = 0; i < 12; i++) {
      const r = await api(app).post('/api/auth/login').send({ email: 'rabia@haven.test', password: `wrong-${i}` });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('STAFF_USE_EMAIL_CODE');
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'rabia@haven.test' } })).lockedUntil).toBeNull();
    await api(app).post('/api/auth/login').send({ email: 'boss@haven.test', password: 'anything' }).expect(403);
  });

  it('locks a family account after too many wrong passwords and tells the owner', async () => {
    await family('mother@haven.test');
    for (let i = 0; i < 10; i++) await api(app).post('/api/auth/login').send({ email: 'mother@haven.test', password: `wrong-${i}` }).expect(401);
    const locked = await api(app).post('/api/auth/login').send({ email: 'mother@haven.test', password: 'Blue-Window-55' });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(mail.outbox.some((m) => m.to === 'mother@haven.test' && m.subject.includes('locked'))).toBe(true);
    await prisma.user.update({ where: { email: 'mother@haven.test' }, data: { lockedUntil: null } });
  });

  it('"this wasn\'t me" link signs every device out', async () => {
    const login = await staffCodeLogin(app, prisma, mail, 'rabia@haven.test', { deviceId: 'tab-1' });
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'rabia@haven.test' } });
    const { SecurityService } = await import('../src/auth/security.service.js');
    const url = new URL(app.get(SecurityService).panicUrl(u.id));
    const res = await api(app).get(`${url.pathname}${url.search}`);
    expect(res.text).toContain('Every device was signed out');
    await api(app).post('/api/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401);
    const forged = await api(app).get(`${url.pathname}${url.search.replace(/sig=[^&]+/, 'sig=nope')}`);
    expect(forged.text).toContain('expired');
  });

  it('staff have no password to reset; a family password reset still needs the authenticator code when 2FA is on', async () => {
    const before = mail.outbox.length;
    await api(app).post('/api/auth/forgot-password').send({ email: 'boss@haven.test' }).expect(200);
    expect(mail.outbox.length).toBe(before); // nothing sent, same answer
    const staff = await api(app).post('/api/auth/reset-password').send({ email: 'boss@haven.test', code: '123456', password: 'Haven-River-33' });
    expect(staff.body.code).toBe('STAFF_USE_EMAIL_CODE');

    const fam = await api(app).post('/api/auth/login').send({ email: 'mother@haven.test', password: 'Blue-Window-55' });
    const auth = { authorization: `Bearer ${fam.body.accessToken}` };
    const setup = await api(app).post('/api/auth/2fa/setup').set(auth);
    await api(app).post('/api/auth/2fa/enable').set(auth).send({ code: await generate({ secret: setup.body.secret }) }).expect(200);
    await prisma.emailOtp.updateMany({ where: { email: 'mother@haven.test' }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await api(app).post('/api/auth/forgot-password').send({ email: 'mother@haven.test' }).expect(200);
    const r = await api(app).post('/api/auth/reset-password').send({ email: 'mother@haven.test', code: lastCodeFor(mail, 'mother@haven.test'), password: 'Haven-River-33' });
    expect(r.body).toMatchObject({ mfaRequired: true, kind: 'TOTP' });
    expect(r.body.accessToken).toBeUndefined();
  });
});
