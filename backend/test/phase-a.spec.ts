import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTeacher, api, bootApp, newSchool, photo, startFakeAi, type FakeAi } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import { CheckingService } from '../src/checking/checking.service.js';
import { RateLimiterService } from '../src/checking/rate-limiter.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/** Phase A: photo gate, problem copies, error classes, rate limit, key versions, undo, cost report, cursors. */
describe('Phase A — accuracy, cost and queue safety', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let ai: FakeAi;
  let admin: Record<string, string>;
  let teacher: Record<string, string>;
  const ids: Record<string, string> = {};
  const students: string[] = [];

  const upload = (sid: string, n = 1, mode?: string) => {
    let r = api(app).post(`/api/teacher/tests/${ids.test}/students/${sid}/copy${mode ? `?mode=${mode}` : ''}`).set(teacher);
    for (let i = 0; i < n; i++) r = r.attach('pages', photo, { filename: `p${i}.png`, contentType: 'image/png' });
    return r;
  };
  const sub = (sid: string) => prisma.submission.findUniqueOrThrow({ where: { testId_studentId: { testId: ids.test, studentId: sid } }, include: { problems: true } });
  const run = async (sid: string) => app.get(CheckingService).process((await sub(sid)).id);

  beforeAll(async () => {
    ai = await startFakeAi(18765);
    ({ app, prisma, mail } = await bootApp());
    ({ auth: admin } = await newSchool(app, prisma, mail, { schoolName: 'Phase School', email: 'admin@phase.test' }));
    const c = await api(app).post('/api/admin/classes').set(admin).send({ name: 'Class 7', grade: 7, sections: ['A'] });
    const sec = c.body.sections[0].id;
    const sb = await api(app).post('/api/admin/subjects').set(admin).send({ name: 'Science' });
    const t = await addTeacher(app, prisma, mail, admin, { name: 'Nadia Teacher', email: 'nadia@phase.test' });
    const a = await api(app).post('/api/admin/assignments').set(admin).send({ teacherId: t.id, sectionId: sec, subjectId: sb.body.id });
    for (let i = 1; i <= 6; i++) {
      await api(app).post('/api/admin/students').set(admin).send({ name: `Kid ${i}`, email: `kid${i}@phase.test`, sectionId: sec, rollNo: String(i).padStart(2, '0') });
    }
    teacher = t.auth;
    const test = await api(app).post(`/api/teacher/assignments/${a.body.id}/tests`).set(teacher).send({
      title: 'Science Quiz', expectedPages: 2, confirmKey: true,
      questions: [
        { number: 1, text: 'Name a gas', maxMarks: 2, answerKey: 'oxygen' },
        { number: 2, text: 'Pick one', maxMarks: 1, answerKey: 'B', type: 'MCQ', finalAnswer: 'B', options: ['A', 'B', 'C', 'D'] },
        { number: 3, text: '6 x 7', maxMarks: 2, answerKey: '42', type: 'NUMERIC', finalAnswer: '42', rules: [{ id: 'R1', text: 'any method' }] },
      ],
    });
    expect(test.status, JSON.stringify(test.body)).toBe(201);
    ids.test = test.body.id;
    const roster = await api(app).get(`/api/teacher/tests/${ids.test}`).set(teacher);
    students.push(...roster.body.roster.map((r: any) => r.studentId));
  });
  afterAll(async () => {
    await app.get(CheckingService).queue?.deleteAllJobs(); // leave no queued work for the next spec file
    await app.close();
    ai.close();
  });

  it('the structured key (type, final answer, rules) is sent to the AI and versioned', async () => {
    const key = await api(app).get(`/api/teacher/tests/${ids.test}/answer-key`).set(teacher);
    expect(key.body).toMatchObject({ keyStatus: 'CONFIRMED', keyVersion: 1 });
    expect(key.body.questions[1]).toMatchObject({ type: 'MCQ', finalAnswer: 'B' });
    expect(key.body.questions[2].rules).toEqual([{ id: 'R1', text: 'any method' }]);
  });

  it('a blurry photo never reaches the AI: the copy becomes a problem and the teacher is told', async () => {
    ai.qualityFlags = ['blurry'];
    await upload(students[0], 2).expect(201);
    await run(students[0]);
    ai.qualityFlags = [];
    const s = await sub(students[0]);
    expect(s.status).toBe('NEEDS_ATTENTION');
    expect(s.problems.map((p) => p.type)).toEqual(['BLURRY', 'BLURRY']);
    expect(ai.calls.filter((c) => c === '/v1/check')).toHaveLength(0);
    const notes = await api(app).get('/api/notifications').set(teacher);
    expect(notes.body.some((n: any) => n.title.startsWith('Retake needed'))).toBe(true);
    const list = await api(app).get(`/api/teacher/tests/${ids.test}/problems`).set(teacher);
    expect(list.body[0]).toMatchObject({ type: 'BLURRY', rollNo: '01' });
    const t = await api(app).get(`/api/teacher/tests/${ids.test}`).set(teacher);
    expect(t.body.counts.attention).toBe(1);
  });

  it('"check anyway" sends the problem copy to the AI and clears the problems', async () => {
    const s = await sub(students[0]);
    await api(app).post(`/api/teacher/submissions/${s.id}/check-anyway`).set(teacher).expect(200);
    await run(students[0]);
    const after = await sub(students[0]);
    expect(['CHECKED', 'NEEDS_REVIEW']).toContain(after.status);
    expect(after.problems.every((p) => p.resolvedAt)).toBe(true);
  });

  it('missing pages and a duplicate photo of another student are caught', async () => {
    await upload(students[1], 1).expect(201); // test expects 2 pages
    await run(students[1]);
    expect((await sub(students[1])).problems.map((p) => p.type)).toContain('MISSING_PAGES');

    const firstPage = await prisma.page.findFirstOrThrow({ where: { submission: { studentId: students[0], testId: ids.test } } });
    ai.phash = () => firstPage.phash!; // the same photo again
    await upload(students[2], 2).expect(201);
    await run(students[2]);
    ai.phash = (n) => BigInt.asUintN(64, BigInt(n + 1000) * 0x9e3779b97f4a7c15n).toString(16).padStart(16, '0');
    const dup = await sub(students[2]);
    expect(dup.status).toBe('NEEDS_ATTENTION');
    expect(dup.problems.find((p) => p.type === 'DUPLICATE')?.details).toMatch(/roll 01/);
  });

  it('printed QR booklets of different students are not duplicates, but the same booklet page again is', async () => {
    const firstPage = await prisma.page.findFirstOrThrow({ where: { submission: { studentId: students[0], testId: ids.test } } });
    const template = '0123456789abcdef'; // blank booklet template: no other page in this test looks like it
    await prisma.page.update({ where: { id: firstPage.id }, data: { qrCode: 'LP1-booklet-roll01-p1', phash: template } });
    const setQr = async (code: string) => prisma.page.updateMany({ where: { submission: { studentId: students[1], testId: ids.test } }, data: { qrCode: code } });
    const reset = ai.phash;
    ai.phash = () => template; // the blank template makes both pages hash the same
    try {
      await upload(students[1], 1).expect(201);
      await setQr('LP1-booklet-roll02-p1'); // another student's booklet
      await run(students[1]);
      const other = (await sub(students[1])).problems.filter((p) => !p.resolvedAt).map((p) => p.type);
      expect(other).toContain('MISSING_PAGES');
      expect(other).not.toContain('DUPLICATE');

      await upload(students[1], 1).expect(201);
      await setQr('LP1-booklet-roll01-p1'); // roll 01's booklet photographed again
      await run(students[1]);
      const again = (await sub(students[1])).problems.filter((p) => !p.resolvedAt);
      expect(again.find((p) => p.type === 'DUPLICATE')?.details).toMatch(/roll 01/);
    } finally {
      ai.phash = reset;
      await prisma.page.update({ where: { id: firstPage.id }, data: { qrCode: null, phash: firstPage.phash } });
    }
  });

  it('the same page photographed twice inside one copy is caught', async () => {
    const reset = ai.phash;
    ai.phash = () => 'fedcba9876543210'; // both pages of this upload are the same photo
    try {
      await upload(students[1], 2).expect(201);
      await run(students[1]);
      const s = await sub(students[1]);
      expect(s.status).toBe('NEEDS_ATTENTION');
      expect(s.problems.filter((p) => !p.resolvedAt).find((p) => p.type === 'DUPLICATE')?.details).toMatch(/page 1 of this copy/);
    } finally {
      ai.phash = reset;
    }
  });

  it('a permanent AI error fails fast and shows up as a problem (never stuck)', async () => {
    ai.failNext = { status: 502, body: { detail: 'OpenAI key is invalid', retryable: false } };
    await upload(students[3], 2).expect(201);
    await run(students[3]);
    const s = await sub(students[3]);
    expect(s.status).toBe('FAILED');
    expect(s.error).toMatch(/key is invalid/);
    expect(s.problems.map((p) => p.type)).toContain('CHECK_FAILED');
  });

  it('a rate-limit answer blocks the shared bucket for everyone for Retry-After seconds', async () => {
    const limiter = app.get(RateLimiterService);
    ai.failNext = { status: 503, body: { detail: 'OpenAI rate limit', retryable: true, retry_after: 30 }, headers: { 'retry-after': '30' } };
    await upload(students[4], 2).expect(201);
    await run(students[4]);
    expect(await limiter.acquire()).toBeGreaterThanOrEqual(25);
    await prisma.rateBucket.update({ where: { name: 'ai' }, data: { blockedUntil: null } });
    expect(await limiter.acquire()).toBe(0);
  });

  it('the token bucket refills over time and makes callers wait instead of failing', async () => {
    const limiter = app.get(RateLimiterService);
    const prev = process.env.AI_REQUESTS_PER_MINUTE;
    process.env.AI_REQUESTS_PER_MINUTE = '6'; // 0.1 token per second, burst of 2
    try {
      expect(await limiter.acquire('small')).toBe(0);
      expect(await limiter.acquire('small')).toBe(0);
      const wait = await limiter.acquire('small');
      expect(wait).toBeGreaterThanOrEqual(8);
      expect(wait).toBeLessThanOrEqual(11);
      await prisma.$executeRaw`UPDATE "rate_buckets" SET "updatedAt" = now() - interval '12 seconds' WHERE "name" = 'small'`;
      expect(await limiter.acquire('small')).toBe(0); // refilled
    } finally {
      process.env.AI_REQUESTS_PER_MINUTE = prev;
    }
  });

  it('a successful check stores review states, the student quote, rules, model and cost', async () => {
    await upload(students[5], 2).expect(201);
    await run(students[5]);
    const s = await sub(students[5]);
    expect(s.status).toBe('NEEDS_REVIEW');
    const answers = await prisma.answer.findMany({ where: { submissionId: s.id }, include: { question: true }, orderBy: { question: { number: 'asc' } } });
    expect(answers.map((a) => a.reviewState)).toEqual(['SURE', 'SURE', 'CHECK']);
    expect(answers[2]).toMatchObject({ transcription: 'answer 3', ruleIds: ['R1'], model: 'fake', keyVersion: 1 });
    expect(s.obtainedMarks).toBe(2 + 0.5 + 1); // added up in the backend
    const usage = await api(app).get('/api/admin/ai-usage').set(admin);
    expect(usage.body.copiesChecked).toBeGreaterThanOrEqual(2);
    expect(usage.body.costPerCopyUsd).toBeCloseTo(0.0013, 4);
    expect(usage.body.cachedShare).toBeGreaterThan(0.6);
  });

  it('a new key version can re-check copies that used the old key', async () => {
    const key = await api(app).get(`/api/teacher/tests/${ids.test}/answer-key`).set(teacher);
    const qs = key.body.questions.map((q: any) => ({ ...q, alternatives: q.number === 1 ? ['nitrogen'] : q.alternatives }));
    const r = await api(app).put(`/api/teacher/tests/${ids.test}/answer-key`).set(teacher).send({ questions: qs, recheck: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.keyVersion).toBe(2);
    expect(r.body.rechecking).toBeGreaterThanOrEqual(2);
    expect((await sub(students[5])).status).toBe('PENDING');
    await run(students[5]);
    await run(students[0]);
    const a = await prisma.answer.findFirstOrThrow({ where: { submission: { studentId: students[5], testId: ids.test } } });
    expect(a.keyVersion).toBe(2);
  });

  it('bulk "approve all sure copies" can be undone until results are announced', async () => {
    const s0 = await sub(students[0]);
    const detail = await api(app).get(`/api/teacher/submissions/${s0.id}`).set(teacher);
    const check = detail.body.answers.find((a: any) => a.reviewState === 'CHECK');
    await api(app).post(`/api/teacher/answers/${check.id}/confirm`).set(teacher).expect(200); // looked at, mark kept
    expect((await sub(students[0])).status).toBe('CHECKED');
    const bulk = await api(app).post(`/api/teacher/tests/${ids.test}/approve-checked`).set(teacher);
    expect(bulk.body.approved).toBe(1);
    const undo = await api(app).post('/api/teacher/submissions/unapprove').set(teacher).send({ ids: bulk.body.ids });
    expect(undo.body.undone).toBe(1);
    expect((await sub(students[0])).status).toBe('CHECKED');
  });

  it('notifications use cursor pagination (stable order, no duplicates)', async () => {
    const all = await api(app).get('/api/notifications').set(teacher);
    expect(all.body.length).toBeGreaterThan(3);
    const seen = new Set<string>();
    let cursor: string | undefined;
    const page1 = await prisma.notification.findMany({ where: { user: { email: 'nadia@phase.test' } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    for (let i = 0; i < 3; i++) {
      const r = await api(app).get(`/api/notifications${cursor ? `?cursor=${cursor}` : ''}`).set(teacher);
      for (const n of r.body) {
        expect(seen.has(n.id)).toBe(false);
        seen.add(n.id);
      }
      cursor = r.body.at(-1)?.id;
      if (r.body.length < 30) break;
    }
    expect(seen.size).toBe(page1.length);
  });
});
