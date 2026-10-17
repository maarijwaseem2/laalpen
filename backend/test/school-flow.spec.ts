import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTeacher, api, bootApp, loginStaff, newSchool, photo, startFakeAi, waitFor } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/** The whole life of a test: admin sets up school -> teacher checks copies -> student sees result. */
describe('School flow: admin → teacher → student', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaService;
  let ai: Server & { calls: string[] };
  const admin: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let teacherAuth: Record<string, string>;
  let studentAuth: Record<string, string>;
  let otherStudentAuth: Record<string, string>;

  const as = (auth: Record<string, string>) => ({
    get: (u: string) => api(app).get(u).set(auth),
    post: (u: string, b?: object) => api(app).post(u).set(auth).send(b ?? {}),
    patch: (u: string, b: object) => api(app).patch(u).set(auth).send(b),
    del: (u: string) => api(app).delete(u).set(auth),
  });
  const login = async (email: string, password: string) => {
    const r = await api(app).post('/api/auth/login').send({ email, password });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { authorization: `Bearer ${r.body.accessToken}` };
  };
  const passwordFromEmail = (to: string) => {
    const m = [...mail.outbox].reverse().find((x) => x.to === to);
    expect(m).toBeTruthy();
    return m!;
  };

  beforeAll(async () => {
    ai = await startFakeAi();
    ({ app, mail, prisma } = await bootApp());
    Object.assign(admin, (await newSchool(app, prisma, mail, { schoolName: 'Flow School', email: 'admin@flow.test' })).auth);
  });
  afterAll(async () => {
    await app.close();
    ai.close();
  });

  it('admin creates classes with sections and subjects', async () => {
    const c9 = await as(admin).post('/api/admin/classes', { name: 'Class 9', grade: 9, sections: ['A', 'B'] });
    expect(c9.status).toBe(201);
    ids.sec9A = c9.body.sections.find((s: any) => s.name === 'A').id;
    ids.sec9B = c9.body.sections.find((s: any) => s.name === 'B').id;
    await as(admin).post('/api/admin/classes', { name: 'Class 9', grade: 9 }).expect(409);

    const phy = await as(admin).post('/api/admin/subjects', { name: 'Physics', code: 'PHY' });
    const mth = await as(admin).post('/api/admin/subjects', { name: 'Mathematics' });
    expect(phy.body.color).toMatch(/^#/);
    ids.phy = phy.body.id;
    ids.mth = mth.body.id;
  });

  it('principal adds a teacher (invite emailed, no password) and assigns two subjects in the same section', async () => {
    const t = await addTeacher(app, prisma, mail, admin, { name: 'Sana Mirza', email: 'sana@flow.test' });
    ids.teacher = t.id;
    expect(mail.outbox.some((m) => m.to === 'sana@flow.test' && /Flow School/.test(m.subject))).toBe(true);
    expect(mail.outbox.some((m) => m.to === 'sana@flow.test' && /password/i.test(m.subject))).toBe(false);

    const a1 = await as(admin).post('/api/admin/assignments', { teacherId: ids.teacher, sectionId: ids.sec9A, subjectId: ids.phy });
    const a2 = await as(admin).post('/api/admin/assignments', { teacherId: ids.teacher, sectionId: ids.sec9A, subjectId: ids.mth });
    expect(a1.status).toBe(201);
    ids.phy9A = a1.body.id;
    ids.mth9A = a2.body.id;
  });

  it('admin adds students section-wise and rejects duplicate roll numbers', async () => {
    const s1 = await as(admin).post('/api/admin/students', { name: 'Ali Raza', email: 'ali@flow.test', sectionId: ids.sec9A, rollNo: '01', guardianEmail: 'parent.ali@flow.test', password: 'Student-Mango-42' });
    expect(s1.status).toBe(201);
    await as(admin).post('/api/admin/students', { name: 'Ayesha', email: 'ayesha@flow.test', sectionId: ids.sec9A, rollNo: '02', password: 'Student-Mango-42' }).expect(201);
    await as(admin).post('/api/admin/students', { name: 'Omar', email: 'omar@flow.test', sectionId: ids.sec9B, rollNo: '01', password: 'Student-Mango-42' }).expect(201);
    const dup = await as(admin).post('/api/admin/students', { name: 'Xavier', email: 'x@flow.test', sectionId: ids.sec9A, rollNo: '01' });
    expect(dup.status).toBe(409);

    const list = await as(admin).get(`/api/admin/students?sectionId=${ids.sec9A}`);
    expect(list.body.map((s: any) => s.rollNo)).toEqual(['01', '02']);
    const sec = await as(admin).get(`/api/admin/sections/${ids.sec9A}`);
    expect(sec.body.subjects).toHaveLength(2);

    const dash = await as(admin).get('/api/admin/dashboard');
    expect(dash.body.stats).toMatchObject({ classes: 1, sections: 2, teachers: 1, students: 3, subjects: 2 });
  });

  it('roles are enforced', async () => {
    teacherAuth = await loginStaff(app, prisma, mail, 'sana@flow.test');
    studentAuth = await login('ali@flow.test', 'Student-Mango-42');
    otherStudentAuth = await login('omar@flow.test', 'Student-Mango-42');
    await as(teacherAuth).get('/api/admin/dashboard').expect(403);
    await as(studentAuth).get('/api/teacher/classes').expect(403);
    await as(admin).get('/api/student/dashboard').expect(403);
  });

  it('teacher sees classes as tiles, with both subjects inside the section', async () => {
    const r = await as(teacherAuth).get('/api/teacher/classes');
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ className: 'Class 9', sectionName: 'A', students: 2 });
    expect(r.body[0].subjects.map((s: any) => s.subject).sort()).toEqual(['Mathematics', 'Physics']);
    const detail = await as(teacherAuth).get(`/api/teacher/assignments/${ids.phy9A}`);
    expect(detail.body.students).toHaveLength(2);
    expect(detail.body.otherSubjects[0].subject).toBe('Mathematics');
  });

  it('teacher creates a test with a marking scheme', async () => {
    const bad = await as(teacherAuth).post(`/api/teacher/assignments/${ids.phy9A}/tests`, { title: 'T', questions: [] });
    expect(bad.status).toBe(400);
    const r = await as(teacherAuth).post(`/api/teacher/assignments/${ids.phy9A}/tests`, {
      title: 'Unit Test 1',
      questions: [
        { number: 1, text: 'Define speed', maxMarks: 4, answerKey: 'distance per unit time' },
        { number: 2, text: '150 m in 12 s', maxMarks: 6, answerKey: '12.5 m/s' },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.totalMarks).toBe(10);
    ids.test = r.body.id;
    const roster = await as(teacherAuth).get(`/api/teacher/tests/${ids.test}`);
    ids.aliProfile = roster.body.roster.find((x: any) => x.name === 'Ali Raza').studentId;
    ids.ayeshaProfile = roster.body.roster.find((x: any) => x.name === 'Ayesha').studentId;
    expect(roster.body.keyStatus).toBe('DRAFT');
  });

  it('copies wait until the teacher confirms the AI-structured answer key', async () => {
    const early = await api(app).post(`/api/teacher/tests/${ids.test}/students/${ids.aliProfile}/copy`).set(teacherAuth).attach('pages', photo, { filename: 'p.png', contentType: 'image/png' });
    expect(early.status).toBe(400);
    expect(early.body.code).toBe('KEY_NOT_CONFIRMED');

    const draft = await as(teacherAuth).post(`/api/teacher/tests/${ids.test}/answer-key/draft`, { text: '' });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect(draft.body.questions[1]).toMatchObject({ number: 2, type: 'NUMERIC', finalAnswer: '12.5 m/s' });
    const bad = await api(app).put(`/api/teacher/tests/${ids.test}/answer-key`).set(teacherAuth).send({ questions: [{ ...draft.body.questions[0], steps: [{ marks: 9, description: 'too many' }] }] });
    expect(bad.status).toBe(400); // step marks cannot add up to more than the question
    const ok = await api(app).put(`/api/teacher/tests/${ids.test}/answer-key`).set(teacherAuth).send({ questions: draft.body.questions });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ keyStatus: 'CONFIRMED', keyVersion: 1 });
    expect(ok.body.questions[0].rules[0].id).toBe('R1');
    const usage = await prisma.aiUsage.findMany({ where: { testId: ids.test } });
    expect(usage.map((u) => u.purpose)).toEqual(['answer-key']);
  });

  it('upload checks file types and section membership', async () => {
    const wrongType = await api(app).post(`/api/teacher/tests/${ids.test}/students/${ids.aliProfile}/copy`).set(teacherAuth).attach('pages', Buffer.from('%PDF'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(wrongType.status).toBe(400);
    const omar = await prisma.studentProfile.findFirstOrThrow({ where: { user: { email: 'omar@flow.test' } } });
    const otherSection = await api(app).post(`/api/teacher/tests/${ids.test}/students/${omar.id}/copy`).set(teacherAuth).attach('pages', photo, { filename: 'p.png', contentType: 'image/png' });
    expect(otherSection.status).toBe(404);
  });

  it('uploaded copies are checked in the background by the AI service', async () => {
    for (const sid of [ids.aliProfile, ids.ayeshaProfile]) {
      const r = await api(app).post(`/api/teacher/tests/${ids.test}/students/${sid}/copy`).set(teacherAuth).attach('pages', photo, { filename: 'page1.png', contentType: 'image/png' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const t = await waitFor(() => as(teacherAuth).get(`/api/teacher/tests/${ids.test}`), (r) => r.body.counts.pending === 0 && r.body.counts.uploaded === 2);
    expect(t.body.counts).toMatchObject({ uploaded: 2, review: 2, pending: 0 });
    expect(ai.calls.filter((c) => c === '/v1/check')).toHaveLength(2);
    const ali = t.body.roster.find((x: any) => x.name === 'Ali Raza');
    expect(ali.submission.obtainedMarks).toBe(7); // 4 + 6/2, added up in the backend
    ids.aliSub = ali.submission.id;
    expect(ai.calls.filter((c) => c === '/v1/quality')).toHaveLength(2); // photo gate before any AI cost
    const cost = await prisma.aiUsage.aggregate({ where: { testId: ids.test, purpose: 'check' }, _sum: { costUsd: true, cachedTokens: true } });
    expect(cost._sum.cachedTokens).toBe(4096);

    // the "checking finished" notification is written right after the last copy, so wait for it
    const notes = await waitFor(() => as(teacherAuth).get('/api/notifications'), (r) => r.body.some((n: any) => n.type === 'CHECKING'));
    expect(notes.body.some((n: any) => n.type === 'CHECKING' && n.title.includes('Unit Test 1'))).toBe(true);
  });

  it('teacher reviews: sees signed copy links, edits marks with limits, approves', async () => {
    const s = await as(teacherAuth).get(`/api/teacher/submissions/${ids.aliSub}`);
    expect(s.body.status).toBe('NEEDS_REVIEW');
    expect(s.body.pages[0].checkedUrl).toMatch(/^\/files\?key=/);
    const file = await api(app).get(s.body.pages[0].checkedUrl);
    expect(file.status).toBe(200);
    await api(app).get(s.body.pages[0].checkedUrl.replace(/sig=[^&]+/, 'sig=forged')).expect(403);

    const q2 = s.body.answers.find((a: any) => a.number === 2);
    expect(q2.needsReview).toBe(true);
    expect(q2).toMatchObject({ reviewState: 'CHECK', studentText: 'answer 2', rulesApplied: [{ id: 'R1' }], aiComment: 'Show the formula' });
    expect(s.body.answers[0].reviewState).toBe('SURE');
    await as(teacherAuth).patch(`/api/teacher/answers/${q2.id}`, { finalMarks: 9 }).expect(400); // more than max
    await as(teacherAuth).patch(`/api/teacher/answers/${q2.id}`, { finalMarks: 4.3 }).expect(400); // steps of 0.5
    const upd = await as(teacherAuth).patch(`/api/teacher/answers/${q2.id}`, { finalMarks: 5, comment: 'Unit missing', overrideReason: 'AI misread' });
    expect(upd.body.obtainedMarks).toBe(9);
    expect(upd.body.status).toBe('CHECKED'); // nothing left to review
    expect(upd.body.previous).toMatchObject({ finalMarks: 3, comment: 'Show the formula' });
    // undo goes back to the AI's mark and comment; redo the edit
    const undo = await as(teacherAuth).patch(`/api/teacher/answers/${q2.id}`, { revert: true });
    expect(undo.body.answers[1]).toMatchObject({ finalMarks: 3, comment: 'Show the formula', teacherEdited: false, needsReview: true });
    expect(undo.body.status).toBe('NEEDS_REVIEW');
    await as(teacherAuth).patch(`/api/teacher/answers/${q2.id}`, { finalMarks: 5, comment: 'Unit missing', overrideReason: 'AI misread' }).expect(200);

    // student cannot see it yet
    await as(studentAuth).get(`/api/student/results/${ids.aliSub}`).expect(404);

    const approved = await as(teacherAuth).post(`/api/teacher/submissions/${ids.aliSub}/approve`);
    expect(approved.body.status).toBe('APPROVED');
    expect(ai.calls).toContain('/v1/annotate'); // red pen redrawn with the teacher's marks
    await as(teacherAuth).patch(`/api/teacher/answers/${q2.id}`, { finalMarks: 4 }).expect(400); // locked after approval
  });

  it('publishing notifies students and emails guardians; only approved copies are visible', async () => {
    const pub = await as(teacherAuth).post(`/api/teacher/tests/${ids.test}/publish`);
    expect(pub.body.published).toBe(1);
    expect(mail.outbox.some((m) => m.to === 'parent.ali@flow.test' && m.subject.includes('9/10'))).toBe(true);

    const dash = await as(studentAuth).get('/api/student/dashboard');
    expect(dash.body.stats).toMatchObject({ results: 1, average: 90 });
    expect(dash.body.subjects.map((s: any) => s.subject).sort()).toEqual(['Mathematics', 'Physics']);

    const result = await as(studentAuth).get(`/api/student/results/${ids.aliSub}`);
    expect(result.body).toMatchObject({ obtained: 9, total: 10, percent: 90 });
    expect(result.body.answers[1]).toMatchObject({ number: 2, marks: 5, comment: 'Unit missing' });
    expect(result.body.pages[0].url).toMatch(/^\/files/);

    const subj = await as(studentAuth).get(`/api/student/subjects/${ids.phy9A}`);
    expect(subj.body.results).toHaveLength(1);

    // another student can never open Ali's copy
    await as(otherStudentAuth).get(`/api/student/results/${ids.aliSub}`).expect(404);

    const bell = await as(studentAuth).get('/api/notifications/unread-count');
    expect(bell.body.count).toBeGreaterThanOrEqual(2); // welcome + result
    await as(studentAuth).post('/api/notifications/read-all').expect(201);
    expect((await as(studentAuth).get('/api/notifications/unread-count')).body.count).toBe(0);
  });

  it('a late approval after publishing reaches the student immediately', async () => {
    const t = await as(teacherAuth).get(`/api/teacher/tests/${ids.test}`);
    const ay = t.body.roster.find((x: any) => x.name === 'Ayesha').submission;
    await as(teacherAuth).post(`/api/teacher/submissions/${ay.id}/approve`).expect(200);
    const ayeshaAuth = await login('ayesha@flow.test', 'Student-Mango-42');
    const dash = await as(ayeshaAuth).get('/api/student/dashboard');
    expect(dash.body.stats.results).toBe(1);
  });

  it('protects published data from destructive changes', async () => {
    await as(teacherAuth).del(`/api/teacher/tests/${ids.test}`).expect(400);
    await as(admin).del(`/api/admin/teachers/${ids.teacher}`).expect(400);
    await as(admin).del(`/api/admin/assignments/${ids.phy9A}`).expect(400);
    await as(admin).del(`/api/admin/sections/${ids.sec9A}`).expect(400);
    await as(admin).patch(`/api/admin/teachers/${ids.teacher}`, { isActive: false }).expect(200);
    await prisma.emailOtp.updateMany({ where: { email: 'sana@flow.test' }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const before = mail.outbox.length;
    await api(app).post('/api/auth/email-code/start').send({ email: 'sana@flow.test' }).expect(200); // same answer, but no code for a disabled account
    expect(mail.outbox.length).toBe(before);
  });
});
