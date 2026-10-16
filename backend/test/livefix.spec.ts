import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bootApp } from './helpers.js';
import { env } from '../src/config/env.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { hourIn, inWindow, parseHours } from '../src/health/keepalive.service.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Live fixes: files kept in PostgreSQL (hosts with no disk), and demo-domain accounts skipping the undeliverable device email. */
describe('Live fixes — db file storage, device-confirm skip domains', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  const prev = { ...process.env };
  const prevDriver = env.storageDriver;

  beforeAll(async () => {
    process.env.DEVICE_CONFIRM_ROLES = 'TEACHER';
    process.env.DEVICE_CONFIRM_SKIP_DOMAINS = 'demo.test';
    ({ app, prisma } = await bootApp());
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

  it('teachers of a skip domain sign in on a new device without the email code; other teachers still confirm', async () => {
    await api(app).post('/api/auth/register').send({ schoolName: 'Skip School', name: 'Head', email: 'head@skip.test', password: 'Skip-Garden-91' }).expect(201);
    await prisma.user.update({ where: { email: 'head@skip.test' }, data: { emailVerified: true } });
    const head = await api(app).post('/api/auth/login').send({ email: 'head@skip.test', password: 'Skip-Garden-91' });
    const auth = { authorization: `Bearer ${head.body.accessToken}` };
    await api(app).post('/api/admin/teachers').set(auth).send({ name: 'Demo Teacher', email: 'sana@demo.test', password: 'Blue-Window-55' }).expect(201);
    await api(app).post('/api/admin/teachers').set(auth).send({ name: 'Real Teacher', email: 'real@skip.test', password: 'Blue-Window-56' }).expect(201);
    for (const [email, password] of [['sana@demo.test', 'Blue-Window-55'], ['real@skip.test', 'Blue-Window-56']]) {
      const first = await api(app).post('/api/auth/login').send({ email, password, deviceId: 'tab-1' });
      expect(first.body.accessToken).toBeTruthy();
    }
    const demo = await api(app).post('/api/auth/login').send({ email: 'sana@demo.test', password: 'Blue-Window-55', deviceId: 'android-new' });
    expect(demo.body.accessToken).toBeTruthy();
    const real = await api(app).post('/api/auth/login').send({ email: 'real@skip.test', password: 'Blue-Window-56', deviceId: 'android-new' });
    expect(real.body).toMatchObject({ mfaRequired: true, kind: 'EMAIL_DEVICE' });
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
