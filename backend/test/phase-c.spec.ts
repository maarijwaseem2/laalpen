import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTeacher, api, bootApp, newSchool, startFakeAi, stepUpStaff, waitFor, type FakeAi } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import { CheckingService } from '../src/checking/checking.service.js';
import { SheetsService } from '../src/scan/sheets.service.js';
import { mcqLetter } from '../src/scan/scan.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/** Phase C: QR booklets + stack scanning, OMR sheets, principal insights, exports, passkeys. */
describe('Phase C — scanning, OMR, insights, exports', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let ai: FakeAi;
  let admin: Record<string, string>;
  let teacher: Record<string, string>;
  const ids: Record<string, string> = {};
  const kids: Record<string, string> = {};

  /** a distinct small photo per call (same bytes would look like one photo uploaded twice) */
  let shade = 10;
  const pic = () => sharp({ create: { width: 40, height: 56, channels: 3, background: { r: 250, g: 250, b: (shade += 7) % 255 } } }).jpeg().toBuffer();

  beforeAll(async () => {
    ai = await startFakeAi(18765);
    ai.lastState = 'sure';
    ({ app, prisma, mail } = await bootApp());
    ({ auth: admin } = await newSchool(app, prisma, mail, { schoolName: 'Scan School', email: 'admin@scan.test' }));
    const c = await api(app).post('/api/admin/classes').set(admin).send({ name: 'Class 8', grade: 8, sections: ['A'] });
    ids.sec = c.body.sections[0].id;
    const sub = await api(app).post('/api/admin/subjects').set(admin).send({ name: 'Science' });
    const t = await addTeacher(app, prisma, mail, admin, { name: 'Kiran Teacher', email: 'kiran@scan.test' });
    const a = await api(app).post('/api/admin/assignments').set(admin).send({ teacherId: t.id, sectionId: ids.sec, subjectId: sub.body.id });
    ids.assignment = a.body.id;
    teacher = t.auth;
    await api(app).post(`/api/teacher/sections/${ids.sec}/students`).set(teacher).send({ text: '01 Asad Ali\n02 Bushra Khan\n03 Faisal Noor' }).expect(200);
    for (const s of await prisma.studentProfile.findMany({ where: { sectionId: ids.sec } })) kids[s.rollNo] = s.id;
    const written = await api(app).post(`/api/teacher/assignments/${ids.assignment}/tests`).set(teacher).send({
      title: 'Plants', expectedPages: 2, confirmKey: true,
      questions: [
        { number: 1, text: 'What do leaves make?', maxMarks: 2, answerKey: 'food (glucose) by photosynthesis' },
        { number: 2, text: 'Name the green pigment', maxMarks: 2, answerKey: 'chlorophyll' },
      ],
    });
    ids.written = written.body.id;
    const mcq = await api(app).post(`/api/teacher/assignments/${ids.assignment}/tests`).set(teacher).send({
      title: 'MCQ Quiz', confirmKey: true,
      questions: [
        { number: 1, text: 'Plants breathe in', maxMarks: 1, answerKey: 'B', type: 'MCQ', finalAnswer: 'B', options: ['O2', 'CO2', 'N2', 'H2'] },
        { number: 2, text: 'Food factory', maxMarks: 1, answerKey: 'A', type: 'MCQ', finalAnswer: 'A) leaf', options: ['leaf', 'root', 'stem', 'flower'] },
        { number: 3, text: 'Water travels in', maxMarks: 1, answerKey: 'C', type: 'MCQ', finalAnswer: 'C', options: ['phloem', 'cortex', 'xylem', 'pith'] },
      ],
    });
    expect(mcq.status, JSON.stringify(mcq.body)).toBe(201);
    ids.mcq = mcq.body.id;
  });
  afterAll(async () => {
    await app.get(CheckingService).queue?.deleteAllJobs();
    await app.close();
    ai.close();
  });

  it('reads the correct option from the many ways teachers write it', () => {
    expect(mcqLetter('B')).toBe('B');
    expect(mcqLetter('(c) xylem')).toBe('C');
    expect(mcqLetter('a) leaf')).toBe('A');
    expect(mcqLetter('Option D')).toBe('D');
    expect(mcqLetter('E', 4)).toBeNull();
    expect(mcqLetter('chlorophyll')).toBeNull();
  });

  it('prints answer booklets, QR stickers and OMR sheets (OMR only for all-MCQ tests)', async () => {
    for (const format of ['booklet', 'stickers']) {
      const r = await api(app).post(`/api/teacher/tests/${ids.written}/booklets`).set(teacher).send({ format, pages: 2 });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ students: 3, pages: 2 });
      const pdf = await api(app).get(r.body.url).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }
    const bad = await api(app).post(`/api/teacher/tests/${ids.written}/omr-sheets`).set(teacher).send({});
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/multiple choice/);
    const omr = await api(app).post(`/api/teacher/tests/${ids.mcq}/omr-sheets`).set(teacher).send({});
    expect(omr.status, JSON.stringify(omr.body)).toBe(200);
    expect(omr.body).toMatchObject({ students: 3, questions: 3, options: 4 });
  });

  it('a signed QR cannot be forged or reused for another test', () => {
    const sheets = app.get(SheetsService);
    const good = sheets.qrText(ids.written, kids['01'], 2, 'c');
    expect(sheets.verify(good)).toMatchObject({ testId: ids.written, studentId: kids['01'], page: 2, kind: 'copy' });
    expect(sheets.verify(good.replace(`.${kids['01']}.`, `.${kids['02']}.`))).toBeNull();
    expect(sheets.verify(`${good}x`)).toBeNull();
    expect(sheets.verify('https://example.com')).toBeNull();
  });

  it('a pile of photos in any order is sorted to the right students and pages', async () => {
    const sheets = app.get(SheetsService);
    ai.scans = {
      'IMG_01.jpg': { qr: sheets.qrText(ids.written, kids['01'], 2, 'c') },
      'IMG_02.jpg': { qr: sheets.qrText(ids.written, kids['02'], 1, 'c') },
      'IMG_03.jpg': { qr: sheets.qrText(ids.written, kids['01'], 1, 'c') },
      'IMG_04.jpg': {},
      'IMG_05.jpg': { qr: sheets.qrText(ids.written, kids['03'], 1, 'c').replace(/\.[^.]+$/, '.forged1234') },
      'IMG_06.jpg': { qr: sheets.qrText(ids.mcq, kids['03'], 1, 'c') },
    };
    let req = api(app).post(`/api/teacher/tests/${ids.written}/stack`).set(teacher);
    for (const name of Object.keys(ai.scans)) req = req.attach('pages', await pic(), { filename: name, contentType: 'image/jpeg' });
    const r = await req;
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const byRoll = Object.fromEntries(r.body.copies.map((c: any) => [c.rollNo, c]));
    expect(byRoll['01']).toMatchObject({ pages: 2, missing: [] });
    expect(byRoll['02']).toMatchObject({ pages: 1, missing: [2] });
    expect(r.body.unmatched.map((u: any) => u.reason)).toEqual([
      expect.stringMatching(/No LaalPen QR/),
      expect.stringMatching(/not from LaalPen/),
      expect.stringMatching(/another test/),
    ]);
    const asad = await prisma.submission.findUniqueOrThrow({ where: { testId_studentId: { testId: ids.written, studentId: kids['01'] } }, include: { pages: { orderBy: { pageNo: 'asc' } } } });
    expect(asad.pages.map((p) => p.pageNo)).toEqual([1, 2]);
    expect(asad.pages.every((p) => p.qrCode?.startsWith('LP1.'))).toBe(true);
    const done = await waitFor(() => prisma.submission.findUniqueOrThrow({ where: { id: asad.id } }), (s) => s.status === 'CHECKED', 20000);
    expect(done.status).toBe('CHECKED');

    // the same pile again (teacher pressed upload twice): nothing is duplicated
    let again = api(app).post(`/api/teacher/tests/${ids.written}/stack`).set(teacher);
    ai.scans = { 'IMG_A.jpg': { qr: sheets.qrText(ids.written, kids['02'], 2, 'c') } };
    again = again.attach('pages', await pic(), { filename: 'IMG_A.jpg', contentType: 'image/jpeg' });
    await again.expect(200);
    expect(await prisma.submission.count({ where: { testId: ids.written } })).toBe(2);
  });

  it('OMR sheets are marked in code — no AI call — and two filled circles go to the teacher', async () => {
    const sheets = app.get(SheetsService);
    const before = ai.calls.filter((c) => c === '/v1/check').length;
    ai.scans = {
      'omr1.jpg': { qr: sheets.qrText(ids.mcq, kids['01'], 1, 'o3x4'), omr: [{ question: 1, choice: 'B', status: 'ok' }, { question: 2, choice: 'A', status: 'ok' }, { question: 3, choice: 'C', status: 'ok' }] },
      'omr2.jpg': { qr: sheets.qrText(ids.mcq, kids['02'], 1, 'o3x4'), omr: [{ question: 1, choice: 'D', status: 'ok' }, { question: 2, choice: null, status: 'multiple' }, { question: 3, choice: null, status: 'blank' }] },
      'omr3.jpg': { qr: sheets.qrText(ids.mcq, kids['03'], 1, 'o3x4'), omr: null },
    };
    let req = api(app).post(`/api/teacher/tests/${ids.mcq}/stack`).set(teacher);
    for (const name of Object.keys(ai.scans)) req = req.attach('pages', await pic(), { filename: name, contentType: 'image/jpeg' });
    const r = await req;
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.omr).toEqual([
      expect.objectContaining({ rollNo: '01', obtained: 3, total: 3, review: 0 }),
      expect.objectContaining({ rollNo: '02', obtained: 0, total: 3, review: 1 }),
    ]);
    expect(r.body.unmatched[0].reason).toMatch(/corner squares/);
    const s2 = await prisma.submission.findUniqueOrThrow({ where: { testId_studentId: { testId: ids.mcq, studentId: kids['02'] } }, include: { answers: { include: { question: true } } } });
    expect(s2.status).toBe('NEEDS_REVIEW');
    const q2 = s2.answers.find((a) => a.question.number === 2)!;
    expect(q2).toMatchObject({ reviewState: 'CHECK', method: 'omr', finalMarks: 0 });
    expect(s2.answers.find((a) => a.question.number === 3)).toMatchObject({ isBlank: true });
    expect(ai.calls.filter((c) => c === '/v1/check').length).toBe(before);
    // the teacher can approve OMR copies like any other
    const s1 = await prisma.submission.findUniqueOrThrow({ where: { testId_studentId: { testId: ids.mcq, studentId: kids['01'] } } });
    expect(s1.status).toBe('CHECKED');
    await api(app).post(`/api/teacher/submissions/${s1.id}/approve`).set(teacher).expect(200);
    ids.mcqApproved = s1.id;
  });

  it('principal insights: turnaround, what is waiting where, classes and the topic heatmap', async () => {
    await api(app).post(`/api/teacher/tests/${ids.mcq}/publish`).set(teacher).expect(200);
    const r = await api(app).get('/api/admin/insights?days=30').set(admin);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.pending.withTeachers).toBeGreaterThanOrEqual(2);
    expect(r.body.pending.approved).toBe(1);
    expect(r.body.turnaround.copies).toBeGreaterThanOrEqual(3);
    expect(r.body.teachers[0]).toMatchObject({ name: 'Kiran Teacher', tests: 2 });
    expect(r.body.classes[0]).toMatchObject({ name: 'Class 8 A', students: 3, tests: 1, average: 100 });
    expect(r.body.heatmap.sections).toEqual([{ id: ids.sec, name: 'Class 8 A' }]);
    expect(r.body.heatmap.cells.length).toBe(3);
    expect(r.body.heatmap.cells.every((c: any) => c.percent === 100)).toBe(true);
    await api(app).get('/api/admin/insights').set(teacher).expect(403);
  });

  it('results export (Excel / CSV) needs a fresh password check and blocks spreadsheet formulas', async () => {
    await prisma.studentProfile.update({ where: { id: kids['01'] }, data: { name: '=HYPERLINK("http://evil")' } });
    await prisma.session.updateMany({ where: { user: { email: 'admin@scan.test' } }, data: { stepUpAt: null } });
    const blocked = await api(app).get('/api/admin/export/results?format=xlsx').set(admin);
    expect(blocked.body.code).toBe('STEP_UP_REQUIRED');
    expect((await stepUpStaff(app, prisma, mail, admin, 'admin@scan.test')).status).toBe(200);
    const x = await api(app).get('/api/admin/export/results?format=xlsx').set(admin);
    expect(x.status, JSON.stringify(x.body)).toBe(200);
    expect(x.body.rows).toBe(1);
    const file = await api(app).get(x.body.url).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Results', 'Subject averages']);
    expect(wb.getWorksheet('Results')!.getRow(2).getCell(12).value).toBe(100);
    const c = await api(app).get('/api/admin/export/results?format=csv').set(admin);
    const csv = await api(app).get(c.body.url);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('passkeys: add one, sign in with it (no extra code), phishing site and replay are refused', async () => {
    const { softAuthenticator } = await import('./soft-authenticator.js');
    const key = softAuthenticator();
    const opt = await api(app).post('/api/auth/passkeys/register/options').set(teacher).send({});
    expect(opt.status, JSON.stringify(opt.body)).toBe(200);
    expect(opt.body.options.rp).toMatchObject({ id: 'localhost', name: 'LaalPen' });
    const reg = await api(app).post('/api/auth/passkeys/register/verify').set(teacher).send({ challengeId: opt.body.challengeId, response: key.create(opt.body.options), name: 'Kiran’s phone' });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    // the same registration cannot be replayed
    await api(app).post('/api/auth/passkeys/register/verify').set(teacher).send({ challengeId: opt.body.challengeId, response: key.create(opt.body.options) }).expect(400);
    expect((await api(app).get('/api/auth/passkeys').set(teacher)).body).toHaveLength(1);

    const lo = await api(app).post('/api/auth/passkeys/login/options').send({ email: 'kiran@scan.test' });
    expect(lo.body.options.allowCredentials).toEqual([expect.objectContaining({ id: key.id })]);
    // a look-alike site cannot use the passkey
    const phish = await api(app).post('/api/auth/passkeys/login/verify').send({ challengeId: lo.body.challengeId, response: key.get(lo.body.options, { origin: 'https://laalpen-login.example' }) });
    expect(phish.status).toBe(401);
    const lo2 = await api(app).post('/api/auth/passkeys/login/options').send({ email: 'kiran@scan.test' });
    const ok = await api(app).post('/api/auth/passkeys/login/verify').send({ challengeId: lo2.body.challengeId, response: key.get(lo2.body.options), deviceId: 'pk-device' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.user.passkeys).toBe(1);
    await api(app).post('/api/auth/passkeys/login/verify').send({ challengeId: lo2.body.challengeId, response: key.get(lo2.body.options) }).expect(400); // challenge used
    // unknown email: same shape of answer, nothing revealed
    const unknown = await api(app).post('/api/auth/passkeys/login/options').send({ email: 'nobody@scan.test' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.options.allowCredentials).toEqual([]);
    const list = await api(app).get('/api/auth/passkeys').set(teacher);
    await api(app).delete(`/api/auth/passkeys/${list.body[0].id}`).set(teacher).expect(200);
  });
});
