import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTeacher, api, bootApp, newSchool } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import { env } from '../src/config/env.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { hourIn, inWindow, parseHours } from '../src/health/keepalive.service.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Live fixes: files kept in PostgreSQL (hosts with no disk), and demo-domain accounts skipping the undeliverable device email. */
describe('Live fixes — db file storage, device-confirm skip domains', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let storage: StorageService;
  const prev = { ...process.env };
  const prevDriver = env.storageDriver;

  beforeAll(async () => {
    process.env.DEVICE_CONFIRM_ROLES = 'TEACHER';
    process.env.DEVICE_CONFIRM_SKIP_DOMAINS = 'demo.test';
    ({ app, prisma, mail } = await bootApp());
    storage = app.get(StorageService);
    (env as { storageDriver: string }).storageDriver = 'db';
  });
  afterAll(async () => {
    (env as { storageDriver: string }).storageDriver = prevDriver;
    process.env.DEVICE_CONFIRM_ROLES = prev.DEVICE_CONFIRM_ROLES;
    process.env.DEVICE_CONFIRM_SKIP_DOMAINS = prev.DEVICE_CONFIRM_SKIP_DOMAINS;
    await app.close();
  });

  it('db driver: saves, serves through a signed /files link, and deletes files from PostgreSQL', async () => {
    await storage.save('submissions/x1/page-1.png', PNG, 'image/png');
    expect(await prisma.storedFile.count({ where: { key: 'submissions/x1/page-1.png' } })).toBe(1);
    expect((await storage.read('submissions/x1/page-1.png')).equals(PNG)).toBe(true);
    expect(await storage.exists('submissions/x1/page-1.png')).toBe(true);
    const res = await api(app).get(storage.signedUrl('submissions/x1/page-1.png')!).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.from(res.body).equals(PNG)).toBe(true);
    await api(app).get(storage.signedUrl('submissions/x1/missing.jpg')!).expect(404);
    await api(app).get('/files?key=submissions%2Fx1%2Fpage-1.png&exp=9999999999&sig=forged').expect(403);
    await storage.removeDir('submissions/x1');
    expect(await storage.exists('submissions/x1/page-1.png')).toBe(false);
  });

  it('rejects path tricks in db keys too', async () => {
    await expect(storage.save('../etc/passwd', PNG)).rejects.toThrow();
  });

  it('demo-school staff (no mailbox) see their sign-in code on screen; real staff only get it by email', async () => {
    const { auth } = await newSchool(app, prisma, mail, { schoolName: 'Skip School', email: 'head@skip.test' });
    await addTeacher(app, prisma, mail, auth, { name: 'Real Teacher', email: 'real@skip.test' });
    await api(app).post('/api/admin/teachers').set(auth).send({ name: 'Demo Teacher', email: 'sana@laalpen.demo' }).expect(201);
    const demo = await api(app).post('/api/auth/email-code/start').send({ email: 'sana@laalpen.demo' }).expect(200);
    expect(demo.body.demoCode).toMatch(/^\d{6}$/);
    const signedIn = await api(app).post('/api/auth/email-code/verify').send({ email: 'sana@laalpen.demo', code: demo.body.demoCode }).expect(200);
    expect(signedIn.body.user.role).toBe('TEACHER');
    await prisma.emailOtp.updateMany({ where: { email: 'real@skip.test' }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const real = await api(app).post('/api/auth/email-code/start').send({ email: 'real@skip.test' }).expect(200);
    expect(real.body.demoCode).toBeUndefined();
    expect(real.body.email).toBe('re**@skip.test');
  });

  it('liveness endpoint answers without touching the database or AI service', async () => {
    const r = await api(app).get('/api/health/live').expect(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('keep-alive hours: parses the window, wraps past midnight, reads the school time zone', () => {
    expect(parseHours('9-21')).toEqual([9, 21]);
    expect(parseHours('')).toBeNull();
    expect(parseHours('nonsense')).toBeNull();
    expect(inWindow(9, [9, 21])).toBe(true);
    expect(inWindow(21, [9, 21])).toBe(false);
    expect(inWindow(23, [22, 6])).toBe(true);
    expect(inWindow(12, [22, 6])).toBe(false);
    expect(hourIn('Asia/Karachi', new Date('2026-10-16T04:30:00Z'))).toBe(9);
  });
});
