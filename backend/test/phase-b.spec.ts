import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, bootApp, photo, startFakeAi, waitFor, type FakeAi } from './helpers.js';
import { CheckingService } from '../src/checking/checking.service.js';
import { MessagingService } from '../src/messaging/messaging.service.js';
import { RosterService } from '../src/roster/roster.service.js';
import { TenantService } from '../src/tenant/tenant.service.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Phase B: roster import, claims (auto-link / teacher link / claim card), parents by phone (siblings),
 * class capture with presigned uploads + one "class done" alert, grade by question, comment bank,
 * share links, step-up + mark history + append-only audit, refresh-token reuse, tenant isolation,
 * overnight batch checking, mark-left and year-end promotion.
 */
describe('Phase B — roster, claims, parents, capture, security', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let ai: FakeAi;
  let admin: Record<string, string>;
  let teacher: Record<string, string>;
  let teacher2: Record<string, string>;
  let parent: Record<string, string>;
  const ids: Record<string, string> = {};

  const login = async (email: string, password: string) => {
    const r = await api(app).post('/api/auth/login').send({ email, password });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { authorization: `Bearer ${r.body.accessToken}`, refresh: r.body.refreshToken as string };
  };
  const auth = (h: Record<string, string>) => ({ authorization: h.authorization });
  const lastCode = (to: string) => [...mail.outbox].reverse().find((m) => m.to === to)?.code;
  const student = (admissionNo: string) => prisma.studentProfile.findFirstOrThrow({ where: { admissionNo } });
  const csv = (rows: string[]) => Buffer.from(['GR No,Student Name,Father Name,Class,Section,Roll No,DOB,Father Mobile', ...rows].join('\n'));

  beforeAll(async () => {
    ai = await startFakeAi(18765);
    ai.lastState = 'sure';
    ({ app, prisma, mail } = await bootApp());
    await api(app).post('/api/auth/register').send({ schoolName: 'Roster School', name: 'Principal', email: 'admin@roster.test', password: 'Secret-Mango-42' });
    await prisma.user.update({ where: { email: 'admin@roster.test' }, data: { emailVerified: true } });
    admin = await login('admin@roster.test', 'Secret-Mango-42');
    const c6 = await api(app).post('/api/admin/classes').set(auth(admin)).send({ name: 'Class 6', grade: 6, sections: ['A'] });
    const c7 = await api(app).post('/api/admin/classes').set(auth(admin)).send({ name: 'Class 7', grade: 7, sections: ['A'] });
    ids.class6 = c6.body.id;
    ids.class7 = c7.body.id;
    ids.sec6 = c6.body.sections[0].id;
    ids.sec7 = c7.body.sections[0].id;
    const sub = await api(app).post('/api/admin/subjects').set(auth(admin)).send({ name: 'Maths' });
    const t1 = await api(app).post('/api/admin/teachers').set(auth(admin)).send({ name: 'Amna Teacher', email: 'amna@roster.test', password: 'Teacher-Mango-42' });
    const t2 = await api(app).post('/api/admin/teachers').set(auth(admin)).send({ name: 'Babar Teacher', email: 'babar@roster.test', password: 'Teacher-Mango-42' });
    const a1 = await api(app).post('/api/admin/assignments').set(auth(admin)).send({ teacherId: t1.body.id, sectionId: ids.sec6, subjectId: sub.body.id });
    await api(app).post('/api/admin/assignments').set(auth(admin)).send({ teacherId: t2.body.id, sectionId: ids.sec7, subjectId: sub.body.id });
    ids.assignment = a1.body.id;
    ids.teacher = t1.body.id;
    teacher = await login('amna@roster.test', 'Teacher-Mango-42');
    teacher2 = await login('babar@roster.test', 'Teacher-Mango-42');
  });
  afterAll(async () => {
    await app.get(CheckingService).queue?.deleteAllJobs();
    await app.close();
    ai.close();
  });

  // ---------- roster ----------

  it('Excel/CSV import: dry run shows problems, commit adds students, re-import updates instead of duplicating', async () => {
    const file = csv([
      'G-101,Ali Raza,Raza Khan,6,A,01,05/03/2014,0300 1234567',
      'G-102,Sara Raza,Raza Khan,6,A,02,11/08/2015,+92 300 1234567',
      'G-103,Hamza Iqbal,Iqbal Ahmed,6,A,03,31/02/2014,0301 7654321',
      'G-104,Bilal Ahmed,Ahmed Ali,6,A,02,01/01/2014,',
    ]);
    const dry = await api(app).post('/api/admin/import/students').set(auth(admin)).attach('file', file, { filename: 'register.csv', contentType: 'text/csv' });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.summary).toMatchObject({ total: 4, new: 2, errors: 2 });
    expect(dry.body.problems.map((p: any) => p.errors.join(' ')).join(' | ')).toMatch(/Date of birth.*\|.*Roll 02 is repeated/);
    expect(await prisma.studentProfile.count()).toBe(0); // a dry run never writes students

    const errs = await api(app).get(`/api/admin/import/${dry.body.id}/errors`).set(auth(admin));
    expect(errs.status).toBe(200);
    const errFile = await api(app).get(errs.body.url);
    expect(errFile.text).toContain('Line,Name');

    const commit = await api(app).post(`/api/admin/import/${dry.body.id}/commit`).set(auth(admin));
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    expect(commit.body).toMatchObject({ created: 2, updated: 0 });
    await api(app).post(`/api/admin/import/${dry.body.id}/commit`).set(auth(admin)).expect(400); // not twice

    // brother and sister share one guardian (one phone number)
    const g = await prisma.guardian.findMany({ include: { students: true } });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ phone: '+923001234567' });
    expect(g[0].students).toHaveLength(2);

    // same register again with a fixed name + the fixed row: update + new, nothing duplicated
    const again = await api(app).post('/api/admin/import/students').set(auth(admin)).attach('file', csv([
      'G-101,Ali Raza Khan,Raza Khan,6,A,01,05/03/2014,0300 1234567',
      'G-102,Sara Raza,Raza Khan,6,A,02,11/08/2015,0300 1234567',
      'G-103,Hamza Iqbal,Iqbal Ahmed,6,A,03,28/02/2014,0301 7654321',
    ]), { filename: 'register.csv', contentType: 'text/csv' });
    expect(again.body.summary).toMatchObject({ new: 1, updated: 1, unchanged: 1, errors: 0 });
    await api(app).post(`/api/admin/import/${again.body.id}/commit`).set(auth(admin)).expect(200);
    expect(await prisma.studentProfile.count()).toBe(3);
    expect((await student('G-101')).name).toBe('Ali Raza Khan');
    expect(await prisma.enrollment.count()).toBe(3);

    const tpl = await api(app).get('/api/admin/import/template').set(auth(admin));
    expect(tpl.status).toBe(200);
    const xlsx = await api(app).get(tpl.body.url);
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.length ?? xlsx.text.length).toBeGreaterThan(1000);
  });

  it('teacher quick-add: one student per line; repeated roll numbers are skipped with a reason', async () => {
    const r = await api(app).post(`/api/teacher/sections/${ids.sec6}/students`).set(auth(teacher)).send({ text: '04 Usman Ali\n05, Zara Khan, 0321 5555555\n03 Someone Else\nno-roll' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.created.map((c: any) => c.name)).toEqual(['Usman Ali', 'Zara Khan']);
    expect(r.body.skipped).toHaveLength(2);
    // the other teacher does not teach 6-A
    await api(app).post(`/api/teacher/sections/${ids.sec6}/students`).set(auth(teacher2)).send({ text: '09 Test Kid' }).expect(403);
  });

  // ---------- claims ----------

  it('student signs up with the class code + roll + date of birth and is linked automatically (no approval)', async () => {
    const code = await api(app).post(`/api/teacher/sections/${ids.sec6}/join-code`).set(auth(teacher));
    expect(code.status, JSON.stringify(code.body)).toBe(200);
    ids.joinCode = code.body.joinCode;
    const look = await api(app).get(`/api/auth/schools/${ids.joinCode}`);
    expect(look.body.section).toMatchObject({ id: ids.sec6, className: 'Class 6' });

    const r = await api(app).post('/api/auth/claim').send({ code: ids.joinCode, name: 'Ali Raza', rollNo: '01', dob: '2014-03-05', email: 'ali@roster.test', password: 'Student-Mango-42' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await api(app).post('/api/auth/verify-email').send({ email: 'ali@roster.test', code: lastCode('ali@roster.test') }).expect(200);

    const ali = await student('G-101');
    expect(ali.userId).toBeTruthy();
    const s = await login('ali@roster.test', 'Student-Mango-42');
    const st = await api(app).get('/api/student/enrollment').set(auth(s));
    expect(st.body).toMatchObject({ status: 'APPROVED', rollNo: '01' });
    await api(app).get('/api/student/dashboard').set(auth(s)).expect(200);
    expect(await prisma.studentProfile.count()).toBe(5); // linked, not duplicated
    expect(await api(app).get('/api/requests/count').set(auth(teacher)).then((x) => x.body.count)).toBe(0);
  });

  it('a mismatch goes to the section teacher with suggestions; the teacher links to the right roster student', async () => {
    await api(app).post('/api/auth/claim').send({ code: ids.joinCode, name: 'Hamza Iqbal', rollNo: '03', dob: '2014-02-27', email: 'hamza@roster.test', password: 'Student-Mango-42' }).expect(201);
    await api(app).post('/api/auth/verify-email').send({ email: 'hamza@roster.test', code: lastCode('hamza@roster.test') }).expect(200);
    expect((await student('G-103')).userId).toBeNull(); // DOB did not match → not automatic

    const list = await api(app).get('/api/requests').set(auth(teacher));
    expect(list.body).toHaveLength(1);
    const req = list.body[0];
    const hamza = await student('G-103');
    expect(req.suggestions[0]).toMatchObject({ id: hamza.id, rollNo: '03', taken: false });
    expect(req.rollTakenBy).toBe('Hamza Iqbal');

    // the other section's teacher cannot see or approve it
    expect((await api(app).get('/api/requests').set(auth(teacher2))).body).toHaveLength(0);
    await api(app).post(`/api/requests/${req.id}/approve`).set(auth(teacher2)).send({ studentId: hamza.id }).expect(404);

    const ok = await api(app).post(`/api/requests/${req.id}/approve`).set(auth(teacher)).send({ studentId: hamza.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await student('G-103')).userId).toBeTruthy();
    expect(await prisma.studentProfile.count()).toBe(5);
    await api(app).post(`/api/requests/${req.id}/approve`).set(auth(teacher)).send({}).expect(400); // handled already
  });

  it('a printed claim card code links exactly one student, once', async () => {
    const sara = await student('G-102');
    const cards = await api(app).post('/api/admin/claim-cards').set(auth(admin)).send({ studentIds: [sara.id] });
    expect(cards.status, JSON.stringify(cards.body)).toBe(200);
    expect(cards.body.count).toBe(1);
    expect(cards.body.url).toMatch(/\/files\?key=exports/);
    const pdf = await api(app).get(cards.body.url);
    expect(pdf.status).toBe(200);

    const [card] = await app.get(RosterService).newClaimCodes(sara.schoolId, [sara.id], 'STUDENT'); // a fresh code (old one stops working)
    const r = await api(app).post('/api/auth/claim').send({ claimCode: card.code, email: 'sara@roster.test', password: 'Student-Mango-42' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await api(app).post('/api/auth/verify-email').send({ email: 'sara@roster.test', code: lastCode('sara@roster.test') }).expect(200);
    expect((await student('G-102')).userId).toBeTruthy();
    await api(app).post('/api/auth/claim').send({ claimCode: card.code, email: 'sara2@roster.test', password: 'Student-Mango-42' }).expect(400);
  });

  // ---------- parents ----------

  it('parent signs in with the phone number on file and sees both children; unknown numbers get the same answer', async () => {
    const msg = app.get(MessagingService);
    const before = msg.outbox.length;
    const unknown = await api(app).post('/api/auth/phone/start').send({ phone: '0333 0000000' });
    expect(unknown.status).toBe(200);
    expect(msg.outbox.length).toBe(before); // no code sent, same reply

    const start = await api(app).post('/api/auth/phone/start').send({ phone: '0300-1234567' });
    expect(start.status).toBe(200);
    expect(start.body.message).toBe(unknown.body.message);
    const code = [...msg.outbox].reverse().find((m) => m.to === '+923001234567' && m.kind === 'code')!.code!;
    await api(app).post('/api/auth/phone/verify').send({ phone: '03001234567', code: code === '000000' ? '111111' : '000000' }).expect(400);
    const v = await api(app).post('/api/auth/phone/verify').send({ phone: '03001234567', code, deviceId: 'parent-phone' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.user.role).toBe('PARENT');
    parent = { authorization: `Bearer ${v.body.accessToken}` };

    const kids = await api(app).get('/api/parent/children').set(parent);
    expect(kids.body.map((k: any) => k.name).sort()).toEqual(['Ali Raza Khan', 'Sara Raza']);
    await api(app).get(`/api/parent/children/${kids.body[0].id}/dashboard`).set(parent).expect(200);
    const hamza = await student('G-103');
    await api(app).get(`/api/parent/children/${hamza.id}/dashboard`).set(parent).expect(404); // not their child
    await api(app).get('/api/student/dashboard').set(parent).expect(403);
  });

  // ---------- capture ----------

  it('class capture: presigned upload, idempotent confirm, and ONE "class done" alert', async () => {
    const t = await api(app).post(`/api/teacher/assignments/${ids.assignment}/tests`).set(auth(teacher)).send({
      title: 'Fractions', confirmKey: true,
      questions: [
        { number: 1, text: '1/2 + 1/2', maxMarks: 2, answerKey: '1' },
        { number: 2, text: 'Explain a fraction', maxMarks: 3, answerKey: 'part of a whole' },
      ],
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    ids.test = t.body.id;
    const batch = await api(app).post(`/api/teacher/tests/${ids.test}/batches`).set(auth(teacher));
    expect(batch.status, JSON.stringify(batch.body)).toBe(200);
    ids.batch = batch.body.id;

    for (const adm of ['G-101', 'G-102']) {
      const s = await student(adm);
      const localId = `local-${adm}-p1-abcdef123456`;
      const pre = await api(app).post('/api/teacher/uploads/presign').set(auth(teacher)).send({ testId: ids.test, studentId: s.id, pageNo: 1, localId, contentType: 'image/png' });
      expect(pre.status, JSON.stringify(pre.body)).toBe(200);
      const url = new URL(pre.body.url);
      await api(app).put(url.pathname + url.search).set('content-type', 'image/png').send(photo).expect(200);
      // a forged upload link is refused
      await api(app).put(url.pathname + url.search.replace(/sig=[^&]+/, 'sig=forged')).set('content-type', 'image/png').send(photo).expect(403);
      const body = { testId: ids.test, studentId: s.id, batchId: ids.batch, pages: [{ pageNo: 1, localId, key: pre.body.key }] };
      const c1 = await api(app).post('/api/teacher/uploads/confirm').set(auth(teacher)).send(body);
      expect(c1.status, JSON.stringify(c1.body)).toBe(200);
      const c2 = await api(app).post('/api/teacher/uploads/confirm').set(auth(teacher)).send(body); // the phone retried
      expect(c2.body).toMatchObject({ submissionId: c1.body.submissionId, duplicate: true });
      const again = await api(app).post('/api/teacher/uploads/presign').set(auth(teacher)).send({ testId: ids.test, studentId: s.id, pageNo: 1, localId });
      expect(again.body.alreadyUploaded).toBe(true);
    }
    expect(await prisma.page.count({ where: { testId: ids.test } })).toBe(2);

    await api(app).post(`/api/teacher/batches/${ids.batch}/close`).set(auth(teacher)).expect(200);
    const done = await waitFor(() => api(app).get(`/api/teacher/batches/${ids.batch}`).set(auth(teacher)).then((r) => r.body), (b) => b.status === 'DONE', 30000);
    expect(done).toMatchObject({ status: 'DONE', total: 2, done: 2, problems: 0 });
    const alerts = await prisma.notification.findMany({ where: { userId: ids.teacher, type: 'CHECKING' } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/Class 6 A Maths: 2 checked/);
  });

  it('grade one question across the class, mark identical answers together, and reuse comments', async () => {
    const q = await api(app).get(`/api/teacher/tests/${ids.test}/questions/2`).set(auth(teacher));
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.answers).toHaveLength(2);
    expect(q.body.groups).toHaveLength(1); // both wrote "answer 2"
    const g = await api(app).post(`/api/teacher/tests/${ids.test}/group-marks`).set(auth(teacher)).send({ answerIds: q.body.groups[0].answerIds, finalMarks: 2, comment: 'Give an example' });
    expect(g.body).toEqual({ updated: 2 });
    await api(app).post(`/api/teacher/tests/${ids.test}/group-marks`).set(auth(teacher)).send({ answerIds: q.body.groups[0].answerIds, finalMarks: 9 }).expect(400);
    const after = await api(app).get(`/api/teacher/tests/${ids.test}/questions/2`).set(auth(teacher));
    expect(after.body.answers.every((a: any) => a.finalMarks === 2 && a.teacherEdited)).toBe(true);

    const c = await api(app).post('/api/teacher/comments').set(auth(teacher)).send({ text: 'Show your working' });
    expect(c.status).toBe(201);
    const list = await api(app).get('/api/teacher/comments?q=work').set(auth(teacher));
    expect(list.body.some((x: any) => x.text === 'Show your working')).toBe(true);
    await api(app).delete(`/api/teacher/comments/${c.body.id}`).set(auth(teacher)).expect(200);
  });

  it('publishing sends parents a result message with a share link that works without the app', async () => {
    const subs = await prisma.submission.findMany({ where: { testId: ids.test } });
    for (const s of subs) await api(app).post(`/api/teacher/submissions/${s.id}/approve`).set(auth(teacher)).expect(200);
    const pub = await api(app).post(`/api/teacher/tests/${ids.test}/publish`).set(auth(teacher));
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const msg = app.get(MessagingService);
    const results = msg.outbox.filter((m) => m.kind === 'result' && m.to === '+923001234567');
    expect(results).toHaveLength(2); // one per child
    const link = results[0].text.match(/https?:\/\/\S+/)![0];
    const page = await api(app).get(new URL(link).pathname);
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/Fractions/);
    expect(page.text).toMatch(/Ali Raza Khan|Sara Raza/);
    const bad = await api(app).get(new URL(link).pathname.replace(/.{3}$/, 'xyz'));
    expect(bad.text).toMatch(/expired/i);

    const ali = await student('G-101');
    const aliSub = subs.find((s) => s.studentId === ali.id)!;
    ids.aliSub = aliSub.id;
    const viaParent = await api(app).get(`/api/parent/results/${aliSub.id}`).set(parent);
    expect(viaParent.status, JSON.stringify(viaParent.body)).toBe(200);
    const share = await api(app).post(`/api/share/results/${aliSub.id}`).set(parent);
    expect(share.status, JSON.stringify(share.body)).toBe(201);
    expect(share.body.text).toContain('Ali Raza Khan');
    await api(app).post(`/api/share/results/${aliSub.id}`).set(auth(teacher2)).expect(403);
  });

  it('a parent sees only their own children: results, subjects and notifications', async () => {
    // an unrelated child with a published copy of the same test
    const hamza = await student('G-103');
    const other = await prisma.submission.create({ data: { testId: ids.test, studentId: hamza.id, status: 'APPROVED', obtainedMarks: 3 } as any }).catch(() => null);
    if (other) await api(app).get(`/api/parent/results/${other.id}`).set(parent).expect(404);
    await api(app).get('/api/parent/results/not-a-real-id').set(parent).expect(404);
    const assignment = (await prisma.test.findUniqueOrThrow({ where: { id: ids.test } })).assignmentId;
    await api(app).get(`/api/parent/children/${hamza.id}/subjects/${assignment}`).set(parent).expect(404);
    // staff and student routes stay closed to parents, and parent routes to staff
    await api(app).get(`/api/teacher/submissions/${ids.aliSub}`).set(parent).expect(403);
    await api(app).get(`/api/parent/results/${ids.aliSub}`).set(auth(teacher)).expect(403);
    // the published result reached the parent's bell with test name and marks
    const bell = await api(app).get('/api/notifications').set(parent);
    const r = bell.body.find((n: any) => n.type === 'RESULT' && n.data?.submissionId === ids.aliSub);
    expect(r?.body).toMatch(/Ali Raza Khan scored \d+(\.\d+)?\/\d+ in Fractions/);
    expect(bell.body.every((n: any) => !n.data?.studentId || n.data.studentId !== hamza.id)).toBe(true);
    if (other) await prisma.submission.delete({ where: { id: other.id } });
  });

  it('re-opening a published copy needs a fresh password check, a reason, and shows in the mark history', async () => {
    const sid = (await prisma.session.findFirstOrThrow({ where: { user: { email: 'amna@roster.test' }, revokedAt: null }, orderBy: { createdAt: 'desc' } })).id;
    await prisma.session.updateMany({ where: { user: { email: 'amna@roster.test' } }, data: { stepUpAt: null } });
    const blocked = await api(app).post(`/api/teacher/submissions/${ids.aliSub}/reopen`).set(auth(teacher)).send({ reason: 'Parent asked about Q2' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('STEP_UP_REQUIRED');
    await api(app).post('/api/auth/step-up').set(auth(teacher)).send({ password: 'wrong-password' }).expect(400);
    await api(app).post('/api/auth/step-up').set(auth(teacher)).send({ password: 'Teacher-Mango-42' }).expect(200);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sid } })).stepUpAt).toBeTruthy();
    const ok = await api(app).post(`/api/teacher/submissions/${ids.aliSub}/reopen`).set(auth(teacher)).send({ reason: 'Parent asked about Q2' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('CHECKED');

    const hist = await api(app).get(`/api/teacher/submissions/${ids.aliSub}/history`).set(auth(teacher));
    const actions = hist.body.map((h: any) => h.action);
    expect(actions).toContain('copy.reopen');
    expect(actions).toContain('answer.edit');
    expect(hist.body.find((h: any) => h.action === 'copy.reopen')).toMatchObject({ by: 'Amna Teacher', reason: 'Parent asked about Q2' });
    expect((await prisma.notification.findMany({ where: { user: { email: 'admin@roster.test' }, title: 'Published marks re-opened' } }))).toHaveLength(1);

    const log = await api(app).get('/api/admin/audit').set(auth(admin));
    expect(log.body.some((r: any) => r.action === 'roster.import')).toBe(true);
    // the audit log cannot be edited or deleted, even by the app's own database user
    await expect(prisma.$executeRawUnsafe(`UPDATE "audit_logs" SET "reason" = 'hidden'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "audit_logs"`)).rejects.toThrow(/append-only/);

    // voice note for the student
    const v = await api(app).post(`/api/teacher/submissions/${ids.aliSub}/voice-note`).set(auth(teacher)).attach('audio', Buffer.from('fake-audio'), { filename: 'note.m4a', contentType: 'audio/mp4' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.url).toMatch(/voice-/);
  });

  // ---------- sessions ----------

  it('a refresh token used twice signs that device out (token theft)', async () => {
    const s = await login('babar@roster.test', 'Teacher-Mango-42');
    const r1 = await api(app).post('/api/auth/refresh').send({ refreshToken: s.refresh });
    expect(r1.status).toBe(200);
    await api(app).post('/api/auth/refresh').send({ refreshToken: s.refresh }).expect(401); // stolen copy used
    await api(app).post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401); // whole session ended
    await api(app).get('/api/auth/me').set({ authorization: `Bearer ${r1.body.accessToken}` }).expect(401);
    teacher2 = await login('babar@roster.test', 'Teacher-Mango-42');
    const list = await api(app).get('/api/auth/sessions').set(auth(teacher2));
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });

  // ---------- tenant isolation ----------

  it('another school can never read this school’s students or copies (app checks + database row security)', async () => {
    await api(app).post('/api/auth/register').send({ schoolName: 'Other School', name: 'Other Admin', email: 'admin@other.test', password: 'Secret-Mango-42' });
    await prisma.user.update({ where: { email: 'admin@other.test' }, data: { emailVerified: true } });
    const other = await login('admin@other.test', 'Secret-Mango-42');
    const ali = await student('G-101');
    await api(app).patch(`/api/admin/students/${ali.id}`).set(auth(other)).send({ name: 'Hacked' }).expect(404);
    await api(app).get(`/api/admin/sections/${ids.sec6}`).set(auth(other)).expect(404);
    await api(app).post(`/api/admin/students/${ali.id}/leave`).set(auth(other)).send({}).expect(404);
    await api(app).post(`/api/teacher/submissions/${ids.aliSub}/approve`).set(auth(teacher2)).expect(404);

    const tenant = app.get(TenantService);
    const otherSchool = (await prisma.school.findFirstOrThrow({ where: { name: 'Other School' } })).id;
    const seen = await tenant.read(otherSchool, (tx) => tx.submission.findMany());
    expect(await prisma.submission.count()).toBeGreaterThan(0);
    expect(seen).toHaveLength(0);
    expect(await tenant.read(otherSchool, (tx) => tx.studentProfile.count())).toBe(0);
    expect(tenant.active).toBe(true);
    expect(await tenant.read(ali.schoolId, (tx) => tx.studentProfile.count())).toBe(5);
  });

  // ---------- overnight ----------

  it('overnight tests wait for the half-price batch; "check now" skips the wait', async () => {
    const t = await api(app).post(`/api/teacher/assignments/${ids.assignment}/tests`).set(auth(teacher)).send({
      title: 'Homework', gradingMode: 'OVERNIGHT', confirmKey: true, questions: [{ number: 1, text: '3 x 4', maxMarks: 2, answerKey: '12' }],
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const [usman, zara] = await Promise.all(['Usman Ali', 'Zara Khan'].map((n) => prisma.studentProfile.findFirstOrThrow({ where: { name: n } })));
    for (const s of [usman, zara]) {
      await api(app).post(`/api/teacher/tests/${t.body.id}/students/${s.id}/copy`).set(auth(teacher)).attach('pages', photo, { filename: 'p1.png', contentType: 'image/png' }).expect(201);
    }
    const sub = (id: string) => prisma.submission.findUniqueOrThrow({ where: { testId_studentId: { testId: t.body.id, studentId: id } } });
    // photo checks run at once, the AI waits for the night
    await waitFor(() => sub(usman.id), (s) => s.qualityChecked, 20000);
    await waitFor(() => sub(zara.id), (s) => s.qualityChecked, 20000);
    expect((await sub(usman.id)).status).toBe('PENDING');
    expect(ai.calls.filter((c) => c === '/v1/check').length).toBe(2); // only the two Fractions copies so far

    // Zara's copy is needed now
    await api(app).post(`/api/teacher/submissions/${(await sub(zara.id)).id}/check-now`).set(auth(teacher)).expect(200);
    await waitFor(() => sub(zara.id), (s) => ['CHECKED', 'NEEDS_REVIEW'].includes(s.status), 20000);

    const checking = app.get(CheckingService);
    expect(await checking.submitOvernight()).toBe(1);
    expect((await sub(usman.id)).status).toBe('PROCESSING');
    expect(await checking.pollOvernight()).toBe(1);
    const done = await sub(usman.id);
    expect(done.status).toBe('CHECKED');
    expect(done.obtainedMarks).toBe(2);
    expect(await prisma.aiUsage.count({ where: { model: 'fake-batch' } })).toBe(1);
  });

  // ---------- leaving and year-end ----------

  it('mark as left keeps marks; year-end promotion moves the class and keeps the history', async () => {
    const zara = await prisma.studentProfile.findFirstOrThrow({ where: { name: 'Zara Khan' } });
    await api(app).delete(`/api/admin/students/${zara.id}`).set(auth(admin)).expect(400); // has a checked copy → mark left instead
    await api(app).post(`/api/admin/students/${zara.id}/leave`).set(auth(admin)).send({ reason: 'Moved to Lahore' }).expect(200);
    const roster = await api(app).get(`/api/teacher/tests/${ids.test}`).set(auth(teacher));
    expect(roster.body.roster.some((r: any) => r.name === 'Zara Khan')).toBe(false);
    expect(await prisma.submission.count({ where: { studentId: zara.id } })).toBe(1);

    const hamza = await student('G-103');
    const preview = await api(app).post('/api/admin/promote/preview').set(auth(admin)).send({ fromClassId: ids.class6, toClassId: ids.class7, sessionName: '2027-28', retainIds: [hamza.id] });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ from: 'Class 6', to: 'Class 7', promote: 3, repeat: 1 });

    await prisma.session.updateMany({ where: { user: { email: 'admin@roster.test' } }, data: { stepUpAt: null } });
    expect((await api(app).post('/api/admin/promote').set(auth(admin)).send({ fromClassId: ids.class6, toClassId: ids.class7, sessionName: '2027-28', retainIds: [hamza.id] })).body.code).toBe('STEP_UP_REQUIRED');
    await api(app).post('/api/auth/step-up').set(auth(admin)).send({ password: 'Secret-Mango-42' }).expect(200);
    const done = await api(app).post('/api/admin/promote').set(auth(admin)).send({ fromClassId: ids.class6, toClassId: ids.class7, sessionName: '2027-28', retainIds: [hamza.id] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const ali = await student('G-101');
    expect(ali.sectionId).toBe(ids.sec7);
    expect((await student('G-103')).sectionId).toBe(ids.sec6); // repeats Class 6
    const hist = await prisma.enrollment.findMany({ where: { studentId: ali.id }, include: { session: true }, orderBy: { createdAt: 'asc' } });
    expect(hist.map((h) => [h.session.name, h.state])).toEqual([[expect.stringMatching(/^\d{4}-\d{2}$/), 'PROMOTED'], ['2027-28', 'ACTIVE']]);
    const sessions = await api(app).get('/api/admin/sessions').set(auth(admin));
    expect(sessions.body.find((s: any) => s.isCurrent).name).toBe('2027-28');
    // old marks stay with the student
    const s = await login('ali@roster.test', 'Student-Mango-42');
    const res = await api(app).get('/api/student/results').set(auth(s));
    expect(res.status).toBe(200);
  });
});
