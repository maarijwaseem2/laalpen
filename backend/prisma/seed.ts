/**
 * Seeds the database. Safe to run any number of times (everything is upserted).
 *
 *   npm run db:seed            -> demo school with admin, teachers, students, tests and checked copies
 *   SEED_DEMO=false npm run db:seed  -> nothing demo (production)
 *
 * Demo logins (password for all: Demo@1234)
 *   admin@laalpen.demo           Admin
 *   sana.teacher@laalpen.demo    Teacher (Physics 9-A, 9-B, Maths 9-A)
 *   imran.teacher@laalpen.demo   Teacher (Chemistry 9-A, 9-B, Physics 10-A, English 10-A)
 *   ali.raza@laalpen.demo        Student (9-A)
 *   saad.pending@laalpen.demo    Student who signed up; the teacher still has to link him to the roster
 *   Parent: phone 0300 1112233   (Ali Raza 9-A + his brother Danish Raza 10-A). The code is printed in
 *                                the backend terminal when SMS/WhatsApp keys are not set.
 *
 * Class codes (students type one when they sign up): ALN-9A, ALN-9B, ALN-10A  (school code: ALN-2026)
 * Class 10-A students are on the roster only (no app accounts) — like most real schools on day one.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, 'seed-assets');
const uploadDir = resolve(process.env.UPLOAD_DIR || './uploads');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Demo@1234'; // demo-only accounts; set SEED_DEMO_PASSWORD to change

const SUBJECTS = [
  { name: 'Physics', code: 'PHY', color: '#1E6FB3' },
  { name: 'Chemistry', code: 'CHE', color: '#2E7D32' },
  { name: 'Mathematics', code: 'MTH', color: '#8E24AA' },
  { name: 'Biology', code: 'BIO', color: '#00897B' },
  { name: 'English', code: 'ENG', color: '#EF6C00' },
  { name: 'Computer Science', code: 'CS', color: '#3949AB' },
];

const STUDENTS: Record<string, [string, string][]> = {
  '9-A': [
    ['01', 'Fatima Noor'], ['02', 'Ayesha Khan'], ['03', 'Ali Raza'], ['04', 'Usman Tariq'],
    ['05', 'Hamza Ahmed'], ['06', 'Zainab Hussain'], ['07', 'Bilal Sheikh'], ['08', 'Maryam Iqbal'],
  ],
  '9-B': [['01', 'Hassan Ali'], ['02', 'Sara Malik'], ['03', 'Omar Farooq'], ['04', 'Hira Siddiqui'], ['05', 'Saad Qureshi'], ['06', 'Noor Fatima']],
  '10-A': [['01', 'Ahmed Javed'], ['02', 'Iqra Shah'], ['03', 'Danish Raza'], ['04', 'Mahnoor Butt'], ['05', 'Talha Mirza'], ['06', 'Areeba Aslam']],
};

/** Ali Raza (9-A) and Danish Raza (10-A) are brothers: one parent phone. */
const FAMILY_PHONE = '+923001112233';
const SECTION_NO: Record<string, number> = { '9-A': 1, '9-B': 2, '10-A': 3 };
const phoneFor = (section: string, roll: string, name: string) =>
  name.endsWith(' Raza') && ['9-A-03', '10-A-03'].includes(`${section}-${roll}`) ? FAMILY_PHONE : `+92301${SECTION_NO[section]}${roll.padStart(2, '0')}4455`;
const dobFor = (section: string, roll: string) => {
  const year = section.startsWith('10') ? 2011 : 2012;
  return new Date(Date.UTC(year, (Number(roll) * 3) % 12, 1 + ((Number(roll) * 5) % 27)));
};

const slug = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');

async function user(schoolId: string, email: string, name: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT', hash: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name, role, schoolId },
    create: { email, name, role, schoolId, passwordHash: hash, emailVerified: true },
  });
}

/** STORAGE_DRIVER=db keeps file bytes in PostgreSQL (hosts whose disk is wiped on restart, e.g. Render free). */
const dbStorage = process.env.STORAGE_DRIVER === 'db';

async function assetExists(key: string) {
  return dbStorage ? (await prisma.storedFile.count({ where: { key } })) > 0 : existsSync(join(uploadDir, key));
}

async function copyAsset(file: string, key: string) {
  if (dbStorage) {
    const data = new Uint8Array(await readFile(join(assets, file)));
    await prisma.storedFile.upsert({ where: { key }, update: { data, contentType: 'image/jpeg', size: data.length }, create: { key, data, contentType: 'image/jpeg', size: data.length } });
    return key;
  }
  const dest = join(uploadDir, key);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(join(assets, file), dest);
  return key;
}

async function demo() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const admin = await prisma.user.findUnique({ where: { email: 'admin@laalpen.demo' } });
  const school =
    (admin?.schoolId && (await prisma.school.findUnique({ where: { id: admin.schoolId } }))) ||
    (await prisma.school.create({ data: { name: 'Al-Noor Grammar School', city: 'Karachi', board: 'FBISE', joinCode: 'ALN-2026' } }));
  if (school.joinCode !== 'ALN-2026' && !(await prisma.school.findUnique({ where: { joinCode: 'ALN-2026' } }))) {
    school.joinCode = (await prisma.school.update({ where: { id: school.id }, data: { joinCode: 'ALN-2026' } })).joinCode;
  }
  await user(school.id, 'admin@laalpen.demo', 'Rabia Siddiqui', 'ADMIN', hash);

  // classes & sections
  const sections: Record<string, string> = {};
  for (const [cls, grade, secs] of [['Class 9', 9, ['A', 'B']], ['Class 10', 10, ['A']]] as const) {
    const c = await prisma.schoolClass.upsert({
      where: { schoolId_name: { schoolId: school.id, name: cls } },
      update: { grade },
      create: { schoolId: school.id, name: cls, grade },
    });
    for (const s of secs) {
      const sec = await prisma.section.upsert({ where: { classId_name: { classId: c.id, name: s } }, update: {}, create: { classId: c.id, name: s } });
      sections[`${grade}-${s}`] = sec.id;
    }
  }

  const subjects: Record<string, string> = {};
  for (const s of SUBJECTS) {
    const row = await prisma.subject.upsert({ where: { schoolId_name: { schoolId: school.id, name: s.name } }, update: { code: s.code, color: s.color }, create: { schoolId: school.id, ...s } });
    subjects[s.name] = row.id;
  }

  const sana = await user(school.id, 'sana.teacher@laalpen.demo', 'Sana Mirza', 'TEACHER', hash);
  const imran = await user(school.id, 'imran.teacher@laalpen.demo', 'Imran Qureshi', 'TEACHER', hash);
  const assignments: Record<string, string> = {};
  for (const [teacher, subject, section] of [
    [sana, 'Physics', '9-A'], [sana, 'Physics', '9-B'], [sana, 'Mathematics', '9-A'],
    [imran, 'Chemistry', '9-A'], [imran, 'Chemistry', '9-B'], [imran, 'Physics', '10-A'], [imran, 'English', '10-A'],
  ] as const) {
    const a = await prisma.teachingAssignment.upsert({
      where: { sectionId_subjectId: { sectionId: sections[section], subjectId: subjects[subject] } },
      update: { teacherId: teacher.id },
      create: { teacherId: teacher.id, sectionId: sections[section], subjectId: subjects[subject] },
    });
    assignments[`${subject}-${section}`] = a.id;
  }

  // academic session (April–March) — tests and enrollments belong to it
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const sessionName = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  const current = await prisma.academicSession.findFirst({ where: { schoolId: school.id, isCurrent: true } });
  const session =
    current ??
    (await prisma.academicSession.upsert({
      where: { schoolId_name: { schoolId: school.id, name: sessionName } },
      update: { isCurrent: true },
      create: { schoolId: school.id, name: sessionName, startsOn: new Date(Date.UTC(year, 3, 1)), isCurrent: true },
    }));

  // per-class join codes (rotatable; replace the one school-wide code)
  for (const [key, code] of [['9-A', 'ALN-9A'], ['9-B', 'ALN-9B'], ['10-A', 'ALN-10A']] as const) {
    const taken = await prisma.section.findUnique({ where: { joinCode: code } });
    if (!taken || taken.id === sections[key]) {
      await prisma.section.update({ where: { id: sections[key] }, data: { joinCode: code, joinCodeExpiresAt: new Date(Date.now() + 365 * 86_400_000) } });
    }
  }

  // the roster: every student is a record the school owns; app accounts are linked to it (9-A, 9-B here)
  const profiles: Record<string, string> = {};
  for (const [section, list] of Object.entries(STUDENTS)) {
    for (const [roll, name] of list) {
      const admissionNo = `ALN-${section.replace('-', '')}-${roll}`;
      const withAccount = section !== '10-A';
      const u = withAccount ? await user(school.id, `${slug(name)}@laalpen.demo`, name, 'STUDENT', hash) : null;
      const phone = phoneFor(section, roll, name);
      const data = {
        name,
        sectionId: sections[section],
        rollNo: roll,
        admissionNo,
        dob: dobFor(section, roll),
        fatherName: `${name.split(' ')[1] ?? 'Ahmed'} Sahib`,
        guardianName: `Parent of ${name.split(' ')[0]}`,
        guardianEmail: `parent.${slug(name)}@laalpen.demo`,
        guardianPhone: phone,
        status: 'ACTIVE' as const,
      };
      // find the same student again (by admission no., by account, or by section + roll + name) so re-seeding never duplicates
      const found =
        (await prisma.studentProfile.findUnique({ where: { schoolId_admissionNo: { schoolId: school.id, admissionNo } } })) ??
        (u ? await prisma.studentProfile.findUnique({ where: { userId: u.id } }) : null) ??
        (await prisma.studentProfile.findFirst({ where: { sectionId: sections[section], rollNo: roll, status: 'ACTIVE', admissionNo: null } }));
      const p = found
        ? await prisma.studentProfile.update({ where: { id: found.id }, data: { ...data, userId: u?.id ?? found.userId } })
        : await prisma.studentProfile.create({ data: { ...data, schoolId: school.id, userId: u?.id ?? null } });
      await prisma.enrollment.upsert({
        where: { studentId_sessionId: { studentId: p.id, sessionId: session.id } },
        update: { sectionId: p.sectionId, rollNo: roll, state: 'ACTIVE' },
        create: { studentId: p.id, sessionId: session.id, sectionId: p.sectionId, rollNo: roll },
      });
      const g = await prisma.guardian.upsert({
        where: { schoolId_phone: { schoolId: school.id, phone } },
        update: {},
        create: { schoolId: school.id, phone, name: phone === FAMILY_PHONE ? 'Raza Ahmed' : data.guardianName },
      });
      await prisma.studentGuardian.upsert({ where: { studentId_guardianId: { studentId: p.id, guardianId: g.id } }, update: {}, create: { studentId: p.id, guardianId: g.id } });
      profiles[`${section}-${roll}`] = p.id;
    }
  }

  // ---- Physics 9-A: Unit Test 1 (published, 3 checked copies with red pen) ----
  const demoResults = JSON.parse(await readFile(join(assets, 'demo-results.json'), 'utf8')) as {
    questions: { number: number; text: string; max_marks: number; answer_key: string }[];
    copies: { variant: string; roll: string; total: number; summary: string; answers: { number: number; marks: number; comment: string; reason: string; page: number; region: { y0: number; y1: number } | null }[] }[];
  };
  const phy9a = assignments['Physics-9-A'];
  // the confirmed, structured answer key (what a teacher gets after "Check answer key")
  const KEY: Record<number, { type: 'THEORY' | 'NUMERIC'; finalAnswer: string | null; rules: { id: string; text: string }[]; steps: { marks: number; description: string }[]; topic: string }> = {
    1: { type: 'THEORY', finalAnswer: null, topic: 'Speed: definition', steps: [{ marks: 3, description: 'distance covered per unit time' }, { marks: 2, description: 'SI unit m/s' }], rules: [{ id: 'R1', text: '3 marks for the definition, any wording' }, { id: 'R2', text: '2 marks for the SI unit m/s' }] },
    2: { type: 'NUMERIC', finalAnswer: '12.5 m/s', topic: 'Speed: numericals', steps: [{ marks: 1, description: 'formula v = s / t' }, { marks: 2, description: 'substitution 150 / 12' }, { marks: 2, description: 'answer 12.5 m/s' }], rules: [{ id: 'R1', text: 'Any correct method' }, { id: 'R2', text: '-1 if the unit is missing' }, { id: 'R3', text: 'Correct method, wrong arithmetic: lose the answer marks only' }] },
    3: { type: 'THEORY', finalAnswer: null, topic: "Newton's laws", steps: [], rules: [{ id: 'R1', text: 'Full marks: rest or uniform motion unless an unbalanced external force acts' }, { id: 'R2', text: "-1 if 'unbalanced' / 'external' is missing" }, { id: 'R3', text: 'No marks for the second or third law' }] },
  };
  const questions = demoResults.questions.map((q) => ({ number: q.number, text: q.text, maxMarks: q.max_marks, answerKey: q.answer_key, ...KEY[q.number] }));
  const total = questions.reduce((n, q) => n + q.maxMarks, 0);

  const makeTest = async (title: string, status: 'PUBLISHED' | 'ACTIVE' | 'DRAFT', daysAgo: number) => {
    const existing = await prisma.test.findFirst({ where: { assignmentId: phy9a, title } });
    if (existing) return { test: existing, created: false };
    const test = await prisma.test.create({
      data: {
        assignmentId: phy9a, schoolId: school.id, sessionId: session.id, title, description: 'Chapter 2 — Kinematics', totalMarks: total, status,
        testDate: new Date(Date.now() - daysAgo * 86_400_000), publishedAt: status === 'PUBLISHED' ? new Date(Date.now() - (daysAgo - 1) * 86_400_000) : null,
        keyStatus: 'CONFIRMED', keyVersion: 1, keyConfirmedAt: new Date(Date.now() - daysAgo * 86_400_000), expectedPages: 1,
        questions: { create: questions },
      },
      include: { questions: { orderBy: { number: 'asc' } } },
    });
    await prisma.answerKeyVersion.create({ data: { testId: test.id, version: 1, questions: test.questions.map(({ testId: _t, ...q }) => q) as object } });
    return { test, created: true };
  };

  const QUOTES: Record<string, string[]> = {
    good: ['Speed is the distance covered by a body in unit time. Its SI unit is m/s.', 'v = s / t = 150 / 12 = 12.5 m/s', 'A body remains at rest or keeps moving with uniform velocity unless a force acts on it.'],
    mixed: ['Speed is distance per unit time. SI unit is m/s', 'v = s / t = 150 / 12, v = 13.5', 'Every action has an equal and opposite reaction.'],
    weak: ['speed is how fast [?]', 'v = s x t = 1800', 'force = mass x acceleration'],
  };
  const addCopy = async (testId: string, copy: (typeof demoResults.copies)[number], status: 'APPROVED' | 'CHECKED' | 'NEEDS_REVIEW', schoolId: string) => {
    const qs = await prisma.question.findMany({ where: { testId } });
    const sub = await prisma.submission.create({
      data: {
        testId, schoolId, studentId: profiles[`9-A-${copy.roll}`], status, obtainedMarks: copy.total, aiSummary: copy.summary,
        checkedAt: new Date(), approvedAt: status === 'APPROVED' ? new Date() : null, qualityChecked: true, keyVersion: 1, model: 'gpt-5-mini',
      },
    });
    const original = await copyAsset(`${copy.variant}-page-1.jpg`, `submissions/${sub.id}/page-1.jpg`);
    const checked = await copyAsset(`${copy.variant}-checked-1.jpg`, `submissions/${sub.id}/checked-1.jpg`);
    await prisma.page.create({ data: { submissionId: sub.id, pageNo: 1, originalPath: original, annotatedPath: checked, testId, blurScore: 240, brightness: 245, width: 1240, height: 1754 } });
    for (const a of copy.answers) {
      const q = qs.find((x) => x.number === a.number)!;
      const review = status === 'NEEDS_REVIEW' && a.marks < q.maxMarks && a.marks > 0;
      await prisma.answer.create({
        data: {
          submissionId: sub.id, questionId: q.id, aiMarks: a.marks, finalMarks: a.marks, reason: a.reason, comment: a.comment, aiComment: a.comment,
          confidence: review ? 0.55 : 0.92, needsReview: review, reviewState: review ? 'CHECK' : 'SURE', pageNo: a.page, region: a.region ?? undefined,
          transcription: QUOTES[copy.variant]?.[a.number - 1] ?? null, ruleIds: a.marks < q.maxMarks ? ['R2'] : [], method: q.type === 'NUMERIC' ? 'numeric' : 'llm',
          model: 'gpt-5-mini', keyVersion: 1, samples: review ? [a.marks, a.marks + 1, a.marks] : undefined,
        },
      });
    }
    await prisma.aiUsage.create({ data: { schoolId, testId, submissionId: sub.id, purpose: 'check', model: 'gpt-5-mini', calls: review(status) ? 3 : 1, inputTokens: 3200, cachedTokens: 2048, outputTokens: 900, costUsd: 0.0025 } });
    return sub;
  };
  const review = (s: string) => s === 'NEEDS_REVIEW';

  const t1 = await makeTest('Unit Test 1 — Motion', 'PUBLISHED', 6);
  if (t1.created) {
    for (const c of demoResults.copies) await addCopy(t1.test.id, c, 'APPROVED', school.id);
    // running totals the principal dashboard reads (kept up to date on every approve)
    const subs = await prisma.submission.findMany({ where: { testId: t1.test.id, status: 'APPROVED' }, include: { answers: { include: { question: true } } } });
    const per: Record<string, { sum: number; max: number; n: number }> = {};
    for (const sub of subs) for (const a of sub.answers) {
      const k = String(a.question.number);
      per[k] = { sum: (per[k]?.sum ?? 0) + (a.finalMarks ?? 0), max: a.question.maxMarks, n: (per[k]?.n ?? 0) + 1 };
    }
    await prisma.testStats.upsert({
      where: { testId: t1.test.id },
      update: {},
      create: { testId: t1.test.id, approved: subs.length, sumPercent: subs.reduce((x, s2) => x + ((s2.obtainedMarks ?? 0) / total) * 100, 0), perQuestion: per },
    });
  }

  const t2 = await makeTest('Weekly Quiz — Speed & Velocity', 'ACTIVE', 1);
  if (t2.created) {
    const [good, mixed, weak] = demoResults.copies;
    await addCopy(t2.test.id, good, 'CHECKED', school.id);
    await addCopy(t2.test.id, mixed, 'NEEDS_REVIEW', school.id);
    // a photo that needs a retake: shows the "problem copies" list
    const blurry = await prisma.submission.create({
      data: { testId: t2.test.id, schoolId: school.id, studentId: profiles['9-A-04'], status: 'NEEDS_ATTENTION', qualityChecked: true, error: 'Photo is blurry (page 1)' },
    });
    const key = await copyAsset(`${weak.variant}-page-1.jpg`, `submissions/${blurry.id}/page-1.jpg`);
    await prisma.page.create({ data: { submissionId: blurry.id, pageNo: 1, originalPath: key, testId: t2.test.id, blurScore: 21, brightness: 180, qualityFlags: ['blurry'] } });
    await prisma.problemCopy.create({ data: { schoolId: school.id, testId: t2.test.id, submissionId: blurry.id, type: 'BLURRY', pageNo: 1, details: 'Photo is blurry (page 1)' } });
  }

  // the demo already existed: put back any demo copy photo that is missing (a wiped disk, or a new storage driver)
  {
    const variantOf = new Map<string, string>(demoResults.copies.map((c) => [profiles[`9-A-${c.roll}`], c.variant] as [string, string]));
    variantOf.set(profiles['9-A-04'], demoResults.copies[2].variant); // the blurry retake
    const pages = await prisma.page.findMany({ where: { testId: { in: [t1.test.id, t2.test.id] } }, include: { submission: { select: { studentId: true } } } });
    let restored = 0;
    for (const pg of pages) {
      const variant = variantOf.get(pg.submission.studentId);
      if (!variant) continue;
      for (const [key, kind] of [[pg.originalPath, 'page'], [pg.annotatedPath, 'checked']] as const) {
        if (!key || !/^submissions\/[^/]+\/(page|checked)-1\.jpg$/.test(key) || (await assetExists(key))) continue;
        await copyAsset(`${variant}-${kind}-1.jpg`, key);
        restored++;
      }
    }
    if (restored) console.log(`Restored ${restored} demo copy photo(s).`);
  }

  // a roster student without an account yet, and a sign-up whose details did not match exactly:
  // the teacher sees "Saad Pending → is this Saad Qamar, roll 09?" and links with one tap
  const saadRoster =
    (await prisma.studentProfile.findUnique({ where: { schoolId_admissionNo: { schoolId: school.id, admissionNo: 'ALN-9A-09' } } })) ??
    (await prisma.studentProfile.create({ data: { schoolId: school.id, name: 'Saad Qamar', sectionId: sections['9-A'], rollNo: '09', admissionNo: 'ALN-9A-09', dob: new Date(Date.UTC(2012, 4, 14)), guardianPhone: '+923004445566' } }));
  await prisma.enrollment.upsert({
    where: { studentId_sessionId: { studentId: saadRoster.id, sessionId: session.id } },
    update: {},
    create: { studentId: saadRoster.id, sessionId: session.id, sectionId: saadRoster.sectionId, rollNo: saadRoster.rollNo },
  });
  const saadParent = await prisma.guardian.upsert({ where: { schoolId_phone: { schoolId: school.id, phone: '+923004445566' } }, update: {}, create: { schoolId: school.id, phone: '+923004445566', name: 'Qamar Iqbal' } });
  await prisma.studentGuardian.upsert({ where: { studentId_guardianId: { studentId: saadRoster.id, guardianId: saadParent.id } }, update: {}, create: { studentId: saadRoster.id, guardianId: saadParent.id } });
  const pendingUser = await prisma.user.upsert({
    where: { email: 'saad.pending@laalpen.demo' },
    update: {},
    create: { email: 'saad.pending@laalpen.demo', name: 'Saad Pending', role: 'STUDENT', schoolId: school.id, passwordHash: hash, emailVerified: true },
  });
  if (!(await prisma.studentProfile.findUnique({ where: { userId: pendingUser.id } })) && !(await prisma.claimRequest.count({ where: { userId: pendingUser.id } }))) {
    await prisma.claimRequest.create({ data: { schoolId: school.id, sectionId: sections['9-A'], userId: pendingUser.id, name: 'Saad Qamar', rollNo: '09', dob: new Date(Date.UTC(2012, 4, 15)) } });
  }

  // welcome notifications (only once)
  const ali = await prisma.user.findUniqueOrThrow({ where: { email: 'ali.raza@laalpen.demo' } });
  if (!(await prisma.notification.count({ where: { userId: ali.id } }))) {
    const sub = await prisma.submission.findFirst({ where: { testId: t1.test.id, studentId: profiles['9-A-03'] } });
    await prisma.notification.create({ data: { userId: ali.id, type: 'RESULT', title: 'Result: Unit Test 1 — Motion', body: 'You scored 8/15 in Physics. Tap to see your checked copy.', data: { submissionId: sub?.id } } });
    await prisma.notification.create({ data: { userId: sana.id, type: 'CHECKING', title: 'Checking finished: Weekly Quiz — Speed & Velocity', body: 'Class 9 A — 1 ready to approve, 1 need your review.', data: { testId: t2.test.id } } });
  }

  console.log(`Demo school ready: ${school.name} — session ${session.name}, class codes ALN-9A / ALN-9B / ALN-10A.`);
  console.log(`Log in with admin@laalpen.demo / ${PASSWORD}  (parent demo: phone 0300 1112233)`);
}

async function main() {
  if ((process.env.SEED_DEMO ?? 'true') !== 'false') await demo();
  else console.log('SEED_DEMO=false — nothing to seed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
