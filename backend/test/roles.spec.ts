import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTeacher, api, bearer, bootApp, lastCodeFor, loginStaff, newSchool, staffCodeLogin, superAdmin } from './helpers.js';
import type { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * The role model: one platform SUPER_ADMIN adds schools + principals; principals complete the school profile and add
 * teachers; teachers complete a profile and wait for approval; Parent / Student is the only public sign-up.
 * Staff never use passwords: emailed one-time codes, passkeys (paused after 3 failures) or Google for existing accounts.
 */
describe('Roles & staff sign-in', () => {
  let app: INestApplication;
  let mail: MailService;
  let prisma: PrismaService;
  let root: Record<string, string>;
  let principal: Record<string, string>;
  let schoolId = '';
  let teacherId = '';
  let teacher: Record<string, string>;
  const ids: Record<string, string> = {};
  const age = (email: string) => prisma.emailOtp.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 60_000) } });
  const startCode = async (email: string) => {
    await age(email);
    return api(app).post('/api/auth/email-code/start').send({ email });
  };

  beforeAll(async () => {
    ({ app, mail, prisma } = await bootApp());
    root = await superAdmin(app, prisma, mail);
  });
  afterAll(() => app.close());

  // ---------- super admin ----------

  it('only the super admin creates schools and principals; the principal gets an invite email', async () => {
    const r = await api(app).post('/api/platform/schools').set(root).send({ name: 'Iqra Public School', city: 'Lahore', principalName: 'Nadia Khan', principalEmail: 'nadia@iqra.test' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    schoolId = r.body.id;
    expect(r.body.principal).toMatchObject({ email: 'nadia@iqra.test', role: 'PRINCIPAL' });
    expect(mail.outbox.some((m) => m.to === 'nadia@iqra.test' && m.subject.includes('principal of Iqra Public School'))).toBe(true);
    const p = await prisma.user.findUniqueOrThrow({ where: { email: 'nadia@iqra.test' } });
    expect(p.passwordHash).toBeNull();

    const list = await api(app).get('/api/platform/schools').set(root);
    expect(list.body.map((s: any) => s.name)).toContain('Iqra Public School');
    await api(app).post('/api/platform/schools').set(root).send({ name: 'Dup School', principalName: 'Xavier', principalEmail: 'nadia@iqra.test' }).expect(409);
  });

  it('the principal must complete the school profile (address, phone, classes) before anything else', async () => {
    principal = await loginStaff(app, prisma, mail, 'nadia@iqra.test');
    const me = await api(app).get('/api/auth/me').set(principal);
    expect(me.body).toMatchObject({ role: 'PRINCIPAL', staff: true, usesPassword: false });
    expect(me.body.school.profileComplete).toBe(false);
    const blocked = await api(app).get('/api/admin/dashboard').set(principal);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('SCHOOL_PROFILE_REQUIRED');

    await api(app).put('/api/school/profile').set(principal).send({ name: 'Iqra Public School', address: '12 Mall Road', city: 'Lahore', phone: '042 1234567', classes: [] }).expect(400);
    const saved = await api(app).put('/api/school/profile').set(principal).send({
      name: 'Iqra Public School', address: '12 Mall Road', city: 'Lahore', phone: '042 1234567',
      classes: [{ name: 'Class 9', grade: 9, sections: ['A', 'B'] }], subjects: ['Maths', 'Physics'],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    await api(app).get('/api/admin/dashboard').set(principal).expect(200);
    const secs = await prisma.section.findMany({ where: { schoolClass: { schoolId } }, orderBy: { name: 'asc' } });
    expect(secs.map((s) => s.name)).toEqual(['A', 'B']);
    [ids.sec9A, ids.sec9B] = secs.map((s) => s.id);
  });

  it('principals, teachers and families cannot create schools or principals', async () => {
    await api(app).post('/api/platform/schools').set(principal).send({ name: 'Mine', principalName: 'Me', principalEmail: 'me@x.test' }).expect(403);
    await api(app).get('/api/platform/overview').set(principal).expect(403);
    await api(app).post(`/api/platform/schools/${schoolId}/principals`).set(principal).send({ name: 'Second', email: 'second@iqra.test' }).expect(403);
    // the super admin does not run schools (no principal screens)
    await api(app).post('/api/admin/teachers').set(root).send({ name: 'Bad', email: 'bad@iqra.test' }).expect(403);
  });

  // ---------- teachers ----------

  it('the principal adds a teacher (invite, no password); the teacher is blocked from student data until approved', async () => {
    const t = await api(app).post('/api/admin/teachers').set(principal).send({ name: 'Umar', email: 'umar@iqra.test' });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    teacherId = t.body.id;
    expect(mail.outbox.some((m) => m.to === 'umar@iqra.test' && m.subject.includes('added you as a teacher'))).toBe(true);
    teacher = await loginStaff(app, prisma, mail, 'umar@iqra.test');
    await api(app).post('/api/admin/teachers').set(teacher).send({ name: 'X', email: 'x@iqra.test' }).expect(403); // teachers cannot add teachers
    await api(app).post('/api/platform/schools').set(teacher).send({ name: 'X', principalName: 'X', principalEmail: 'x2@iqra.test' }).expect(403);

    const me = await api(app).get('/api/auth/me').set(teacher);
    expect(me.body.teacher).toMatchObject({ status: 'PROFILE_INCOMPLETE' });
    const blocked = await api(app).get('/api/teacher/classes').set(teacher);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TEACHER_APPROVAL_REQUIRED');
  });

  it('the teacher completes the profile (qualification, subjects, class + subject per section) and waits', async () => {
    const form = await api(app).get('/api/teacher/profile').set(teacher);
    expect(form.body.options.sections.map((s: any) => s.id).sort()).toEqual([ids.sec9A, ids.sec9B].sort());
    await api(app).put('/api/teacher/profile').set(teacher).send({ name: 'Umar Farooq', phone: '0300 1112223', qualification: 'MSc', subjects: ['Maths'], sections: [{ sectionId: 'not-mine', subject: 'Maths' }] }).expect(400);
    const sent = await api(app).put('/api/teacher/profile').set(teacher).send({
      name: 'Umar Farooq', phone: '0300 1112223', qualification: 'MSc Maths, B.Ed', subjects: ['Maths'],
      sections: [{ sectionId: ids.sec9A, subject: 'Maths' }, { sectionId: ids.sec9B, subject: 'Physics' }],
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.status).toBe('PENDING');
    expect(mail.outbox.some((m) => m.to === 'nadia@iqra.test' && m.subject.includes('waiting for your approval'))).toBe(true);
    // still blocked while pending
    expect((await api(app).get('/api/teacher/classes').set(teacher)).body.code).toBe('TEACHER_APPROVAL_REQUIRED');
    const pending = await api(app).get('/api/admin/teachers/pending').set(principal);
    expect(pending.body.map((p: any) => p.id)).toContain(teacherId);
  });

  it('the principal rejects with a reason (email + in-app), the teacher fixes it, then gets approved and sees classes', async () => {
    await api(app).post(`/api/admin/teachers/${teacherId}/reject`).set(principal).send({ reason: '' }).expect(400);
    await api(app).post(`/api/admin/teachers/${teacherId}/reject`).set(principal).send({ reason: 'Please add your B.Ed year' }).expect(200);
    const me = await api(app).get('/api/auth/me').set(teacher);
    expect(me.body.teacher).toMatchObject({ status: 'REJECTED', rejectReason: 'Please add your B.Ed year' });
    expect(mail.outbox.some((m) => m.to === 'umar@iqra.test' && /changes|rejected|update/i.test(m.subject))).toBe(true);
    const bell = await api(app).get('/api/notifications').set(teacher);
    expect(JSON.stringify(bell.body)).toContain('Please add your B.Ed year');

    await api(app).put('/api/teacher/profile').set(teacher).send({
      name: 'Umar Farooq', phone: '0300 1112223', qualification: 'MSc Maths, B.Ed (2019)', subjects: ['Maths'],
      sections: [{ sectionId: ids.sec9A, subject: 'Maths' }, { sectionId: ids.sec9B, subject: 'Physics' }],
    }).expect(200);
    const ok = await api(app).post(`/api/admin/teachers/${teacherId}/approve`).set(principal);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.created).toHaveLength(2);
    expect(mail.outbox.some((m) => m.to === 'umar@iqra.test' && /approved/i.test(m.subject))).toBe(true);
    const classes = await api(app).get('/api/teacher/classes').set(teacher);
    expect(classes.status).toBe(200);
    // an approved profile is locked (changes go through the principal)
    await api(app).put('/api/teacher/profile').set(teacher).send({ name: 'Umar Farooq', phone: '0300 1112223', qualification: 'PhD', subjects: ['Maths'], sections: [{ sectionId: ids.sec9A, subject: 'Maths' }] }).expect(400);
  });

  // ---------- staff sign-in ----------

  it('staff password sign-in is rejected even with the right password; staff cannot reset or change a password', async () => {
    await prisma.user.update({ where: { email: 'umar@iqra.test' }, data: { passwordHash: await bcrypt.hash('Right-Mango-42', 10) } });
    const r = await api(app).post('/api/auth/login').send({ email: 'umar@iqra.test', password: 'Right-Mango-42' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('STAFF_USE_EMAIL_CODE');
    expect(r.body.accessToken).toBeUndefined();
    for (const email of ['nadia@iqra.test', 'root@platform.test']) {
      expect((await api(app).post('/api/auth/login').send({ email, password: 'whatever-123' })).body.code).toBe('STAFF_USE_EMAIL_CODE');
    }
    await api(app).post('/api/auth/change-password').set(teacher).send({ currentPassword: 'Right-Mango-42', newPassword: 'New-Mango-77' }).expect(403);
    await prisma.user.update({ where: { email: 'umar@iqra.test' }, data: { passwordHash: null } });
  });

  it('email code: same answer for everyone, sent only to active staff, single use', async () => {
    const before = mail.outbox.length;
    const unknown = await startCode('nobody@iqra.test');
    expect(unknown.status).toBe(200);
    expect(unknown.body.demoCode).toBeUndefined();
    expect(mail.outbox.length).toBe(before); // no email for an unknown address

    const r = await startCode('umar@iqra.test');
    expect(r.body).toMatchObject({ ok: true, email: 'um**@iqra.test' });
    expect(r.body.demoCode).toBeUndefined(); // real staff only get it by email
    const code = lastCodeFor(mail, 'umar@iqra.test')!;
    expect(mail.outbox.at(-1)!.subject).toContain('sign-in code');
    const ok = await api(app).post('/api/auth/email-code/verify').send({ email: 'umar@iqra.test', code });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    const again = await api(app).post('/api/auth/email-code/verify').send({ email: 'umar@iqra.test', code });
    expect(again.status).toBe(400); // single use
    // resend guard: a second code within 45 s is not sent
    await api(app).post('/api/auth/email-code/start').send({ email: 'umar@iqra.test' }).expect(200);
    const n = mail.outbox.length;
    await api(app).post('/api/auth/email-code/start').send({ email: 'umar@iqra.test' }).expect(200);
    expect(mail.outbox.length).toBe(n);
  });

  it('email code: expires, and only 5 wrong tries are allowed', async () => {
    await startCode('umar@iqra.test');
    const code = lastCodeFor(mail, 'umar@iqra.test')!;
    await prisma.emailOtp.updateMany({ where: { email: 'umar@iqra.test', purpose: 'LOGIN_CODE', usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await api(app).post('/api/auth/email-code/verify').send({ email: 'umar@iqra.test', code });
    expect(expired.status).toBe(400);
    expect(expired.body.message).toMatch(/expired/);

    await startCode('umar@iqra.test');
    const good = lastCodeFor(mail, 'umar@iqra.test')!;
    const wrong = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await api(app).post('/api/auth/email-code/verify').send({ email: 'umar@iqra.test', code: wrong }).expect(400);
    const locked = await api(app).post('/api/auth/email-code/verify').send({ email: 'umar@iqra.test', code: good });
    expect(locked.status).toBe(400);
    expect(locked.body.message).toMatch(/Too many wrong attempts/);
  });

  it('family accounts cannot use staff email codes', async () => {
    await api(app).post('/api/auth/signup').send({ name: 'Ammi', email: 'ammi@iqra.test', password: 'Family-Mango-42' }).expect(201);
    await api(app).post('/api/auth/verify-email').send({ email: 'ammi@iqra.test', code: lastCodeFor(mail, 'ammi@iqra.test') }).expect(200);
    const n = mail.outbox.length;
    expect((await startCode('ammi@iqra.test')).status).toBe(200);
    expect(mail.outbox.length).toBe(n);
    await api(app).post('/api/auth/email-code/verify').send({ email: 'ammi@iqra.test', code: '123456' }).expect(400);
  });

  it('3 failed passkey sign-ins pause passkeys and email an alert; an email code turns them back on', async () => {
    const { softAuthenticator } = await import('./soft-authenticator.js');
    const key = softAuthenticator();
    const opt = await api(app).post('/api/auth/passkeys/register/options').set(teacher).send({});
    await api(app).post('/api/auth/passkeys/register/verify').set(teacher).send({ challengeId: opt.body.challengeId, response: key.create(opt.body.options), name: 'Umar phone' }).expect(200);

    const tryBad = async () => {
      const lo = await api(app).post('/api/auth/passkeys/login/options').send({ email: 'umar@iqra.test' });
      return api(app).post('/api/auth/passkeys/login/verify').send({ challengeId: lo.body.challengeId, response: key.get(lo.body.options, { origin: 'https://evil.example' }) });
    };
    expect((await tryBad()).status).toBe(401);
    expect((await tryBad()).status).toBe(401);
    expect(mail.outbox.some((m) => m.to === 'umar@iqra.test' && m.subject.includes('failed passkey'))).toBe(false);
    expect((await tryBad()).status).toBe(401);
    expect(mail.outbox.filter((m) => m.to === 'umar@iqra.test' && m.subject.includes('3 failed passkey sign-ins'))).toHaveLength(1);

    const lo = await api(app).post('/api/auth/passkeys/login/options').send({ email: 'umar@iqra.test' });
    const blocked = await api(app).post('/api/auth/passkeys/login/verify').send({ challengeId: lo.body.challengeId, response: key.get(lo.body.options) });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSKEY_BLOCKED');
    expect(await prisma.auditLog.count({ where: { action: 'passkey.blocked', entityId: teacherId } })).toBe(1);

    await staffCodeLogin(app, prisma, mail, 'umar@iqra.test'); // email verification unblocks
    const lo2 = await api(app).post('/api/auth/passkeys/login/options').send({ email: 'umar@iqra.test' });
    const ok = await api(app).post('/api/auth/passkeys/login/verify').send({ challengeId: lo2.body.challengeId, response: key.get(lo2.body.options) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
  });

  it('Google never creates staff: existing staff can use it, unknown emails are refused, unverified Google emails fail', async () => {
    const existing = await api(app).post('/api/auth/google').send({ idToken: 'test-google:umar@iqra.test' });
    expect(existing.status).toBe(200);
    expect(existing.body.user.role).toBe('TEACHER');
    const unknown = await api(app).post('/api/auth/google').send({ idToken: 'test-google:newteacher@iqra.test' });
    expect(unknown.status).toBe(404);
    expect(await prisma.user.count({ where: { email: 'newteacher@iqra.test' } })).toBe(0);
    // even with "sign up", Google only ever makes a Parent / Student account
    const signup = await api(app).post('/api/auth/google').send({ idToken: 'test-google:newteacher@iqra.test', signup: true });
    expect(signup.body.user.role).toBe('PARENT');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'newteacher@iqra.test' } })).schoolId).toBeNull();
    await api(app).post('/api/auth/google').send({ idToken: 'test-google-unverified:umar@iqra.test' }).expect(401);
  });

  // ---------- families ----------

  it('Parent / Student sign-up: verify the email, sign in by phone, link a child with the card code', async () => {
    await api(app).post('/api/auth/signup').send({ name: 'Abbu Jee', email: 'abbu@family.test', phone: '0333 4445556', password: 'Family-Mango-42' }).expect(201);
    expect((await api(app).post('/api/auth/login').send({ phone: '03334445556', password: 'Family-Mango-42' })).body.code).toBe('EMAIL_NOT_VERIFIED');
    await api(app).post('/api/auth/verify-email').send({ email: 'abbu@family.test', code: lastCodeFor(mail, 'abbu@family.test') }).expect(200);
    const login = await api(app).post('/api/auth/login').send({ phone: '+92 333 4445556', password: 'Family-Mango-42' });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const fam = bearer(login.body);

    const s = await api(app).post('/api/admin/students').set(principal).send({ name: 'Hira Abbas', sectionId: ids.sec9A, rollNo: '07' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const hira = await prisma.studentProfile.findFirstOrThrow({ where: { name: 'Hira Abbas', schoolId } });
    const { RosterService } = await import('../src/roster/roster.service.js');
    const [card] = await app.get(RosterService).newClaimCodes(schoolId, [hira.id], 'STUDENT');
    const detected = await api(app).get(`/api/parent/code/${encodeURIComponent(card.code)}`).set(fam);
    expect(detected.body).toMatchObject({ kind: 'card', child: { name: 'Hira Abbas' } });
    const linked = await api(app).post('/api/parent/link').set(fam).send({ code: card.code });
    expect(linked.status, JSON.stringify(linked.body)).toBeLessThan(300);
    const kids = await api(app).get('/api/parent/children').set(fam);
    expect(kids.body.map((k: any) => k.name)).toContain('Hira Abbas');
    // families cannot open staff areas
    await api(app).get('/api/admin/dashboard').set(fam).expect(403);
    await api(app).get('/api/teacher/classes').set(fam).expect(403);
    await api(app).get('/api/platform/schools').set(fam).expect(403);
  });

  // ---------- isolation + suspension ----------

  it('schools are isolated: a principal cannot approve, see or touch another school’s teachers', async () => {
    const other = await newSchool(app, prisma, mail, { schoolName: 'Beacon Grammar', email: 'head@beacon.test' });
    const t = await addTeacher(app, prisma, mail, other.auth, { name: 'Beacon Teacher', email: 'bt@beacon.test', approve: false });
    await api(app).post(`/api/admin/teachers/${t.id}/approve`).set(principal).expect(404);
    await api(app).post(`/api/admin/teachers/${t.id}/reject`).set(principal).send({ reason: 'not yours' }).expect(404);
    expect((await api(app).get('/api/admin/teachers/pending').set(principal)).body.map((p: any) => p.id)).not.toContain(t.id);
    await api(app).post(`/api/admin/teachers/${teacherId}/approve`).set(other.auth).expect(404);
    const pf = await api(app).get('/api/teacher/profile').set(t.auth);
    expect(pf.body.options.sections.map((s: any) => s.id)).not.toContain(ids.sec9A);
    await api(app).put('/api/teacher/profile').set(t.auth).send({ name: 'Beacon Teacher', phone: '0300 9998887', qualification: 'BSc', subjects: ['Maths'], sections: [{ sectionId: ids.sec9A, subject: 'Maths' }] }).expect(400);
    ids.beacon = other.schoolId;
    ids.beaconHead = other.principalId;
  });

  it('the super admin suspends a school (its staff are signed out and cannot sign in) and restores it', async () => {
    const head = await loginStaff(app, prisma, mail, 'head@beacon.test');
    await api(app).post(`/api/platform/schools/${ids.beacon}/suspend`).set(principal).send({ reason: 'x' }).expect(403);
    await api(app).post(`/api/platform/schools/${ids.beacon}/suspend`).set(root).send({ reason: 'Fees unpaid' }).expect(200);
    expect((await api(app).get('/api/admin/dashboard').set(head)).status).toBe(401); // sessions revoked
    const n = mail.outbox.length;
    await startCode('head@beacon.test');
    expect(mail.outbox.length).toBe(n); // no code for a suspended school
    await api(app).get('/api/admin/dashboard').set(principal).expect(200); // other schools unaffected
    await api(app).post(`/api/platform/schools/${ids.beacon}/restore`).set(root).expect(200);
    await loginStaff(app, prisma, mail, 'head@beacon.test');

    await api(app).post(`/api/platform/users/${ids.beaconHead}/suspend`).set(root).expect(200);
    const m = mail.outbox.length;
    await startCode('head@beacon.test');
    expect(mail.outbox.length).toBe(m);
    await api(app).post(`/api/platform/users/${ids.beaconHead}/restore`).set(root).expect(200);
    const ov = await api(app).get('/api/platform/overview').set(root);
    expect(ov.status).toBe(200);
  });
});
