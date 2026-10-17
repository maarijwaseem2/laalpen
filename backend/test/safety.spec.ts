import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTeacher, api, bootApp, newSchool, photo, startFakeAi } from './helpers.js';
import { AiClient } from '../src/checking/ai-client.js';
import { CheckingService } from '../src/checking/checking.service.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/** Regression tests for issues found in the independent code review. */
describe('Safety fixes', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaService;
  let ai: Server & { calls: string[] };
  let admin: Record<string, string>;
  let teacher: Record<string, string>;
  const ids: Record<string, string> = {};

  const login = async (email: string, password: string) => {
    const r = await api(app).post('/api/auth/login').send({ email, password });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { authorization: `Bearer ${r.body.accessToken}` };
  };

  beforeAll(async () => {
    ai = await startFakeAi(18765);
    ({ app, mail, prisma } = await bootApp());
    ({ auth: admin } = await newSchool(app, prisma, mail, { schoolName: 'Safe School', email: 'admin@safe.test' }));
    const c = await api(app).post('/api/admin/classes').set(admin).send({ name: 'Class 8', grade: 8, sections: ['A'] });
    ids.sec = c.body.sections[0].id;
    const sub = await api(app).post('/api/admin/subjects').set(admin).send({ name: 'Maths' });
    const t = await addTeacher(app, prisma, mail, admin, { name: 'Tariq Teacher', email: 't@safe.test' });
    ids.teacher = t.id;
    const a = await api(app).post('/api/admin/assignments').set(admin).send({ teacherId: t.id, sectionId: ids.sec, subjectId: sub.body.id });
    const s = await api(app).post('/api/admin/students').set(admin).send({ name: 'Kid One', email: 'kid@safe.test', sectionId: ids.sec, rollNo: '1', guardianEmail: 'parent@safe.test', password: 'Student-Mango-42' });
    ids.student = s.body.userId;
    teacher = t.auth;
    const test = await api(app).post(`/api/teacher/assignments/${a.body.id}/tests`).set(teacher).send({ title: 'Quiz', confirmKey: true, questions: [{ number: 1, text: '2+2', maxMarks: 2, answerKey: '4' }] });
    ids.test = test.body.id;
    ids.profile = (await prisma.studentProfile.findFirstOrThrow({ where: { userId: s.body.userId } })).id;
  });
  afterAll(async () => {
    await app.close();
    ai.close();
  });

  it('a stale check run cannot overwrite the result of a newer upload', async () => {
    const checking = app.get(CheckingService);
    const client = app.get(AiClient);
    const real = client.check.bind(client);
    let bumped = false;
    // while the AI is "thinking", the teacher re-uploads (simulated by a newer run)
    client.check = async (payload, pages) => {
      const res = await real(payload, pages);
      if (!bumped) {
        bumped = true;
        await prisma.submission.update({ where: { id: payload.submission_id }, data: { checkRun: { increment: 1 }, status: 'PENDING' } });
      }
      return res;
    };
    const sub = await prisma.submission.create({ data: { testId: ids.test, studentId: ids.profile } });
    await prisma.page.create({ data: { submissionId: sub.id, pageNo: 1, originalPath: `submissions/${sub.id}/page-1.png` } });
    await app.get((await import('../src/storage/storage.service.js')).StorageService).save(`submissions/${sub.id}/page-1.png`, photo);

    await checking.process(sub.id); // run 0 — overtaken mid-flight
    let row = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id }, include: { answers: true } });
    expect(row.status).toBe('PENDING'); // old results were dropped
    expect(row.answers).toHaveLength(0);

    await checking.process(sub.id); // the newer run
    row = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id }, include: { answers: true } });
    expect(['CHECKED', 'NEEDS_REVIEW']).toContain(row.status);
    expect(row.answers).toHaveLength(1);
    client.check = real;
    ids.sub = sub.id;
  });

  it('a copy cannot be re-uploaded or edited while it is being checked', async () => {
    await prisma.submission.update({ where: { id: ids.sub }, data: { status: 'PROCESSING' } });
    const r = await api(app).post(`/api/teacher/tests/${ids.test}/students/${ids.profile}/copy`).set(teacher).attach('pages', photo, { filename: 'p.png', contentType: 'image/png' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/being checked/);
    await api(app).post(`/api/teacher/submissions/${ids.sub}/recheck`).set(teacher).expect(400);
    await prisma.submission.update({ where: { id: ids.sub }, data: { status: 'CHECKED' } });
  });

  it('publishing twice does not email parents twice', async () => {
    await api(app).post(`/api/teacher/submissions/${ids.sub}/approve`).set(teacher).expect(200);
    const first = await api(app).post(`/api/teacher/tests/${ids.test}/publish`).set(teacher);
    expect(first.body).toMatchObject({ published: 1, notified: 1 });
    const second = await api(app).post(`/api/teacher/tests/${ids.test}/publish`).set(teacher);
    expect(second.body).toMatchObject({ published: 1, notified: 0 });
    expect(mail.outbox.filter((m) => m.to === 'parent@safe.test')).toHaveLength(1);
  });

  it('Google sign-in on an account someone else registered (unverified) removes their password', async () => {
    await api(app).post('/api/auth/signup').send({ name: 'Not Owner', email: 'owner@victim.test', password: 'Attacker-Mango-42' }).expect(201);
    const g = await api(app).post('/api/auth/google').send({ idToken: 'test-google:owner@victim.test' });
    expect(g.status).toBe(200);
    await api(app).post('/api/auth/login').send({ email: 'owner@victim.test', password: 'Attacker-Mango-42' }).expect(401);
  });

  it('an unverified sign-up stops blocking the email once its code has expired', async () => {
    await api(app).post('/api/auth/signup').send({ name: 'Typo Person', email: 'later@safe.test', password: 'Secret-Mango-42' }).expect(201);
    await prisma.user.update({ where: { email: 'later@safe.test' }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
    await api(app).post('/api/auth/signup').send({ name: 'Real Owner', email: 'later@safe.test', password: 'Secret-Mango-42' }).expect(201);
    expect(await prisma.user.count({ where: { name: 'Typo Person' } })).toBe(0);
  });

  it('wrong codes guessed in parallel still count toward the 5-try limit', async () => {
    await prisma.emailOtp.updateMany({ where: { email: 'later@safe.test' }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const guesses = await Promise.all(
      Array.from({ length: 12 }, (_, i) => api(app).post('/api/auth/verify-email').send({ email: 'later@safe.test', code: String(100000 + i) })),
    );
    expect(guesses.filter((g) => g.body.message === 'Incorrect code').length).toBeLessThanOrEqual(5);
    const otp = await prisma.emailOtp.findFirstOrThrow({ where: { email: 'later@safe.test', usedAt: null } });
    expect(otp.attempts).toBe(5);
  });

  it('disabling a teacher locks them out immediately, not after the token expires', async () => {
    await api(app).get('/api/teacher/classes').set(teacher).expect(200);
    await api(app).patch(`/api/admin/teachers/${ids.teacher}`).set(admin).send({ isActive: false }).expect(200);
    await api(app).get('/api/teacher/classes').set(teacher).expect(401);
  });

  it('changing the password logs out other devices; logout removes this phone from push', async () => {
    const kid = await login('kid@safe.test', 'Student-Mango-42');
    const other = await api(app).post('/api/auth/login').send({ email: 'kid@safe.test', password: 'Student-Mango-42' });
    const changed = await api(app).post('/api/auth/change-password').set(kid).send({ currentPassword: 'Student-Mango-42', newPassword: 'Student-Guava-77' });
    expect(changed.status).toBe(200);
    expect(changed.body.accessToken).toBeTruthy();
    await api(app).post('/api/auth/refresh').send({ refreshToken: other.body.refreshToken }).expect(401);

    const me = { authorization: `Bearer ${changed.body.accessToken}` };
    await api(app).post('/api/notifications/push-token').set(me).send({ token: 'ExponentPushToken[abc]', platform: 'android' }).expect(201);
    await api(app).delete('/api/notifications/push-token').set(me).send({ token: 'ExponentPushToken[abc]' }).expect(200);
    expect(await prisma.pushToken.count({ where: { token: 'ExponentPushToken[abc]' } })).toBe(0);
  });

});
