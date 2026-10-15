import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { CheckingService, sha256Buffer, toAiQuestion } from '../checking/checking.service.js';
import { AiClient } from '../checking/ai-client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MailService } from '../mail/mail.service.js';
import { env } from '../config/env.js';
import { round1 } from '../common/util.js';
import type { SubmissionStatus } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { MessagingService } from '../messaging/messaging.service.js';
import { ShareService } from '../share/share.service.js';
import { RosterService } from '../roster/roster.service.js';
import { normalizePage } from '../common/images.js';
import type { AuthUser } from '../common/decorators.js';
import type { ConfirmKeyDto, CreateTestDto, QuestionDto, UpdateAnswerDto, UpdateTestDto } from './teacher.dto.js';
import { sniffImage } from '../common/image-type.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/jpg']);
const emptyCounts = () => ({ uploaded: 0, pending: 0, checked: 0, review: 0, approved: 0, failed: 0, attention: 0 });
type Counts = ReturnType<typeof emptyCounts>;

function addStatus(c: Counts, s: SubmissionStatus, n = 1) {
  c.uploaded += n;
  if (s === 'PENDING' || s === 'PROCESSING') c.pending += n;
  else if (s === 'CHECKED') c.checked += n;
  else if (s === 'NEEDS_REVIEW') c.review += n;
  else if (s === 'APPROVED') c.approved += n;
  else if (s === 'FAILED') {
    c.failed += n;
    c.attention += n;
  } else if (s === 'NEEDS_ATTENTION') c.attention += n;
  return c;
}

function countStatus(statuses: SubmissionStatus[]) {
  const c = emptyCounts();
  for (const s of statuses) addStatus(c, s);
  return c;
}

/** Question rows <-> the structured key the AI uses. */
function questionData(q: QuestionDto) {
  return {
    number: q.number,
    text: q.text,
    maxMarks: q.maxMarks,
    answerKey: q.answerKey ?? '',
    type: q.type ?? 'THEORY',
    finalAnswer: q.finalAnswer || null,
    alternatives: q.alternatives ?? [],
    steps: (q.steps ?? []) as object,
    rules: (q.rules ?? []) as object,
    options: q.options ?? [],
    topic: q.topic || null,
  };
}

export function publicQuestion(q: any) {
  return {
    id: q.id,
    number: q.number,
    text: q.text,
    maxMarks: q.maxMarks,
    answerKey: q.answerKey,
    type: q.type ?? 'THEORY',
    finalAnswer: q.finalAnswer ?? null,
    alternatives: q.alternatives ?? [],
    steps: (q.steps as any[]) ?? [],
    rules: (q.rules as any[]) ?? [],
    options: q.options ?? [],
    topic: q.topic ?? null,
  };
}

@Injectable()
export class TeacherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly checking: CheckingService,
    private readonly ai: AiClient,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly share: ShareService,
    private readonly roster: RosterService,
  ) {}

  // ---------- ownership ----------

  private async ownAssignment(teacherId: string, id: string) {
    const a = await this.prisma.teachingAssignment.findUnique({
      where: { id },
      include: { subject: true, section: { include: { schoolClass: true } } },
    });
    if (!a || a.teacherId !== teacherId) throw new NotFoundException('Class not found');
    return a;
  }

  private async ownTest(teacherId: string, id: string) {
    const t = await this.prisma.test.findUnique({
      where: { id },
      include: { assignment: { include: { subject: true, section: { include: { schoolClass: true } } } }, questions: { orderBy: { number: 'asc' } } },
    });
    if (!t || t.assignment.teacherId !== teacherId) throw new NotFoundException('Test not found');
    return t;
  }

  /** A copy that is queued or being checked is locked for a while, unless the check looks stuck. */
  private assertNotChecking(s: { status: string; updatedAt: Date }) {
    const busy = s.status === 'PENDING' || s.status === 'PROCESSING';
    if (busy && Date.now() - s.updatedAt.getTime() < 10 * 60_000) {
      throw new BadRequestException('This copy is being checked right now. Wait a moment and try again.');
    }
  }

  private async ownSubmission(teacherId: string, id: string) {
    const s = await this.prisma.submission.findUnique({ where: { id }, include: { test: { include: { assignment: true } } } });
    if (!s || s.test.assignment.teacherId !== teacherId) throw new NotFoundException('Copy not found');
    return s;
  }

  /** Status counts per test with one GROUP BY (never loads every submission row). */
  private async countsByTest(testIds: string[]) {
    const out = new Map<string, Counts>();
    if (!testIds.length) return out;
    const rows = await this.prisma.submission.groupBy({ by: ['testId', 'status'], where: { testId: { in: testIds } }, _count: { _all: true } });
    for (const r of rows) addStatus(out.get(r.testId) ?? out.set(r.testId, emptyCounts()).get(r.testId)!, r.status, r._count._all);
    return out;
  }

  // ---------- home ----------

  async classes(teacherId: string) {
    const rows = await this.prisma.teachingAssignment.findMany({
      where: { teacherId },
      include: {
        subject: true,
        section: { include: { schoolClass: true, _count: { select: { students: { where: { status: 'ACTIVE' } } } } } },
        tests: { select: { id: true } },
      },
    });
    const counts = await this.countsByTest(rows.flatMap((a) => a.tests.map((t) => t.id)));
    const bySection = new Map<string, any>();
    for (const a of rows) {
      const key = a.sectionId;
      if (!bySection.has(key)) {
        bySection.set(key, {
          sectionId: a.sectionId,
          classId: a.section.classId,
          className: a.section.schoolClass.name,
          grade: a.section.schoolClass.grade,
          sectionName: a.section.name,
          students: a.section._count.students,
          subjects: [],
        });
      }
      const c = emptyCounts();
      for (const t of a.tests) {
        const tc = counts.get(t.id);
        if (tc) for (const k of Object.keys(c) as (keyof Counts)[]) c[k] += tc[k];
      }
      bySection.get(key).subjects.push({
        assignmentId: a.id,
        subjectId: a.subjectId,
        subject: a.subject.name,
        color: a.subject.color,
        tests: a.tests.length,
        toReview: c.checked + c.review,
        attention: c.attention,
      });
    }
    const pending = await this.prisma.claimRequest.groupBy({
      by: ['sectionId'],
      where: { status: 'PENDING', user: { emailVerified: true }, sectionId: { in: [...bySection.keys()] } },
      _count: { _all: true },
    });
    const pendingBy = new Map(pending.map((p) => [p.sectionId, p._count._all]));
    return [...bySection.values()]
      .map((s) => ({
        ...s,
        joinRequests: pendingBy.get(s.sectionId) ?? 0,
        toReview: s.subjects.reduce((n: number, x: any) => n + x.toReview, 0),
        attention: s.subjects.reduce((n: number, x: any) => n + x.attention, 0),
      }))
      .sort((a, b) => a.grade - b.grade || a.sectionName.localeCompare(b.sectionName));
  }

  async dashboard(teacherId: string) {
    const [classes, tests] = await Promise.all([
      this.classes(teacherId),
      this.prisma.test.findMany({
        where: { assignment: { teacherId } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, title: true, status: true, testDate: true, keyStatus: true, updatedAt: true, assignment: { select: { subject: { select: { name: true, color: true } }, section: { select: { name: true, schoolClass: { select: { name: true } } } } } } },
      }),
    ]);
    const counts = await this.countsByTest(tests.map((t) => t.id));
    const all = emptyCounts();
    for (const c of counts.values()) for (const k of Object.keys(all) as (keyof Counts)[]) all[k] += c[k];
    const problems = await this.prisma.problemCopy.count({ where: { resolvedAt: null, test: { assignment: { teacherId } } } });
    return {
      stats: {
        sections: classes.length,
        students: classes.reduce((n, c) => n + c.students, 0),
        tests: tests.length,
        toReview: all.checked + all.review,
        checking: all.pending,
        approved: all.approved,
        attention: all.attention,
        problems,
        joinRequests: classes.reduce((n, c) => n + c.joinRequests, 0),
        keysToConfirm: tests.filter((t) => t.keyStatus === 'DRAFT').length,
      },
      recentTests: tests.slice(0, 6).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        keyStatus: t.keyStatus,
        testDate: t.testDate,
        subject: t.assignment.subject.name,
        color: t.assignment.subject.color,
        className: t.assignment.section.schoolClass.name,
        sectionName: t.assignment.section.name,
        counts: counts.get(t.id) ?? emptyCounts(),
      })),
    };
  }

  // ---------- subject inside a section ----------

  async assignment(teacherId: string, id: string) {
    const a = await this.ownAssignment(teacherId, id);
    const [students, tests, siblings] = await Promise.all([
      this.prisma.studentProfile.findMany({
        where: { sectionId: a.sectionId, status: 'ACTIVE' },
        orderBy: { rollNo: 'asc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          submissions: { where: { status: 'APPROVED', test: { assignmentId: id } }, select: { obtainedMarks: true, test: { select: { totalMarks: true } } } },
        },
      }),
      this.prisma.test.findMany({ where: { assignmentId: id }, orderBy: [{ testDate: 'desc' }, { id: 'desc' }] }),
      this.prisma.teachingAssignment.findMany({ where: { teacherId, sectionId: a.sectionId }, include: { subject: true } }),
    ]);
    const counts = await this.countsByTest(tests.map((t) => t.id));
    return {
      id: a.id,
      subject: a.subject.name,
      color: a.subject.color,
      sectionId: a.sectionId,
      className: a.section.schoolClass.name,
      sectionName: a.section.name,
      otherSubjects: siblings.filter((s) => s.id !== id).map((s) => ({ assignmentId: s.id, subject: s.subject.name, color: s.subject.color })),
      students: students.map((p) => {
        const scored = p.submissions.filter((s) => s.test.totalMarks > 0);
        const avg = scored.length ? (scored.reduce((n, s) => n + (s.obtainedMarks ?? 0) / s.test.totalMarks, 0) / scored.length) * 100 : null;
        return { id: p.id, userId: p.user?.id ?? null, name: p.name, email: p.user?.email ?? null, hasAccount: !!p.user, rollNo: p.rollNo, average: avg === null ? null : round1(avg), testsTaken: scored.length };
      }),
      tests: tests.map((t) => ({ id: t.id, title: t.title, status: t.status, keyStatus: t.keyStatus, testDate: t.testDate, totalMarks: t.totalMarks, counts: counts.get(t.id) ?? emptyCounts() })),
    };
  }

  // ---------- tests ----------

  async createTest(teacherId: string, assignmentId: string, dto: CreateTestDto) {
    const a = await this.ownAssignment(teacherId, assignmentId);
    const session = await this.roster.currentSession(a.subject.schoolId);
    this.checkQuestions(dto.questions);
    const total = dto.questions.reduce((n, q) => n + q.maxMarks, 0);
    const test = await this.prisma.test.create({
      data: {
        assignmentId,
        title: dto.title,
        description: dto.description,
        testDate: dto.testDate ? new Date(dto.testDate) : new Date(),
        totalMarks: total,
        expectedPages: dto.expectedPages ?? null,
        language: dto.language ?? 'en',
        gradingMode: dto.gradingMode ?? 'INSTANT',
        schoolId: a.subject.schoolId,
        sessionId: session.id,
        questions: { create: dto.questions.map(questionData) },
      },
      include: { questions: { orderBy: { number: 'asc' } } },
    });
    if (dto.confirmKey) await this.confirmKey(teacherId, test.id, { questions: dto.questions });
    return this.prisma.test.findUniqueOrThrow({ where: { id: test.id }, include: { questions: { orderBy: { number: 'asc' } } } });
  }

  private checkQuestions(qs: QuestionDto[]) {
    const nums = qs.map((q) => q.number);
    if (new Set(nums).size !== nums.length) throw new BadRequestException('Question numbers must be unique');
    for (const q of qs) {
      const steps = (q.steps ?? []).reduce((n, s) => n + s.marks, 0);
      if (steps > q.maxMarks + 1e-9) throw new BadRequestException(`Q${q.number}: step marks (${steps}) are more than the question's ${q.maxMarks} marks`);
      if (q.type === 'MCQ' && !q.finalAnswer) throw new BadRequestException(`Q${q.number}: choose the correct option`);
      const ids = (q.rules ?? []).map((r) => r.id);
      if (new Set(ids).size !== ids.length) throw new BadRequestException(`Q${q.number}: rule ids must be unique`);
    }
  }

  async test(teacherId: string, id: string) {
    const t = await this.ownTest(teacherId, id);
    const [students, subs, problems] = await Promise.all([
      this.prisma.studentProfile.findMany({ where: { sectionId: t.assignment.sectionId, status: 'ACTIVE' }, orderBy: { rollNo: 'asc' }, select: { id: true, name: true, rollNo: true } }),
      this.prisma.submission.findMany({ where: { testId: id }, include: { _count: { select: { pages: true } } } }),
      this.prisma.problemCopy.findMany({ where: { testId: id, resolvedAt: null }, select: { submissionId: true, type: true, details: true } }),
    ]);
    const byStudent = new Map(subs.map((s) => [s.studentId, s]));
    const problemsBy = new Map<string, { type: string; details: string }[]>();
    for (const p of problems) problemsBy.set(p.submissionId, [...(problemsBy.get(p.submissionId) ?? []), { type: p.type, details: p.details }]);
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      keyStatus: t.keyStatus,
      keyVersion: t.keyVersion,
      expectedPages: t.expectedPages,
      language: t.language,
      gradingMode: t.gradingMode,
      sessionId: t.sessionId,
      testDate: t.testDate,
      totalMarks: t.totalMarks,
      publishedAt: t.publishedAt,
      assignmentId: t.assignmentId,
      subject: t.assignment.subject.name,
      color: t.assignment.subject.color,
      className: t.assignment.section.schoolClass.name,
      sectionName: t.assignment.section.name,
      questions: t.questions.map(publicQuestion),
      counts: countStatus(subs.map((s) => s.status)),
      problems: problems.length,
      roster: students.map((p) => {
        const s = byStudent.get(p.id);
        return {
          studentId: p.id,
          name: p.name,
          rollNo: p.rollNo,
          submission: s
            ? { id: s.id, status: s.status, obtainedMarks: s.obtainedMarks, pages: s._count.pages, error: s.error, problems: problemsBy.get(s.id) ?? [] }
            : null,
        };
      }),
    };
  }

  async updateTest(teacherId: string, id: string, dto: UpdateTestDto) {
    const t = await this.ownTest(teacherId, id);
    if (t.status === 'PUBLISHED' && dto.questions) throw new BadRequestException('Published tests cannot change questions');
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.testDate !== undefined) data.testDate = new Date(dto.testDate);
    if (dto.expectedPages !== undefined) data.expectedPages = dto.expectedPages;
    if (dto.language !== undefined) data.language = dto.language;
    if (dto.gradingMode !== undefined) data.gradingMode = dto.gradingMode;
    if (dto.questions) {
      const checked = await this.prisma.answer.count({ where: { submission: { testId: id } } });
      if (checked) throw new BadRequestException('Copies are already checked for this test. Change the answer key instead (it can re-check the copies).');
      this.checkQuestions(dto.questions);
      await this.prisma.question.deleteMany({ where: { testId: id } });
      await this.prisma.question.createMany({ data: dto.questions.map((q) => ({ ...questionData(q), testId: id })) });
      data.totalMarks = dto.questions.reduce((n, q) => n + q.maxMarks, 0);
      data.keyStatus = 'DRAFT'; // changed questions need the key confirmed again
    }
    await this.prisma.test.update({ where: { id }, data });
    return this.test(teacherId, id);
  }

  async deleteTest(teacherId: string, id: string) {
    const t = await this.ownTest(teacherId, id);
    if (t.status === 'PUBLISHED') throw new BadRequestException('Published tests cannot be deleted');
    const subs = await this.prisma.submission.findMany({ where: { testId: id }, select: { id: true } });
    await this.prisma.test.delete({ where: { id } });
    await Promise.all(subs.map((s) => this.storage.removeDir(`submissions/${s.id}`)));
    return { ok: true };
  }

  // ---------- answer key ----------

  async getKey(teacherId: string, testId: string) {
    const t = await this.ownTest(teacherId, testId);
    const versions = await this.prisma.answerKeyVersion.findMany({ where: { testId }, orderBy: { version: 'desc' }, select: { version: true, createdAt: true } });
    return { testId, keyStatus: t.keyStatus, keyVersion: t.keyVersion, language: t.language, questions: t.questions.map(publicQuestion), versions };
  }

  /** AI turns the teacher's typed / photographed key into a structured draft. Nothing is saved. */
  async draftKey(teacherId: string, testId: string, text: string | undefined, files: Express.Multer.File[] = []) {
    const t = await this.ownTest(teacherId, testId);
    for (const f of files) if (!ALLOWED.has(f.mimetype) || !sniffImage(f.buffer)) throw new BadRequestException(`${f.originalname}: only JPG, PNG or WEBP photos are allowed`);
    const res = await this.ai.parseKey(
      { subject: t.assignment.subject.name, class_name: t.assignment.section.schoolClass.name, text: text ?? '', questions: t.questions.map((q) => toAiQuestion(publicQuestion(q))) },
      files.map((f, i) => ({ pageNo: i + 1, data: f.buffer, filename: f.originalname || `key-${i + 1}.jpg` })),
    );
    if (res.usage && res.usage.calls) {
      await this.prisma.aiUsage.create({
        data: { schoolId: t.assignment.subject.schoolId, testId, purpose: 'answer-key', model: res.usage.model, calls: res.usage.calls, inputTokens: res.usage.input_tokens, cachedTokens: res.usage.cached_tokens, outputTokens: res.usage.output_tokens, costUsd: res.usage.cost_usd },
      });
    }
    return {
      model: res.model,
      notes: res.notes,
      questions: res.questions.map((q) => ({
        number: q.number,
        text: q.text,
        maxMarks: q.max_marks,
        answerKey: q.answer_key,
        type: (q.type ?? 'theory').toUpperCase(),
        finalAnswer: q.final_answer ?? null,
        alternatives: q.alternatives ?? [],
        steps: q.steps ?? [],
        rules: q.rules ?? [],
        options: q.options ?? [],
        topic: q.topic ?? null,
      })),
    };
  }

  /** The teacher confirms the key: a new numbered version every copy is marked against. */
  async confirmKey(teacherId: string, testId: string, dto: ConfirmKeyDto) {
    const t = await this.ownTest(teacherId, testId);
    if (t.status === 'PUBLISHED') throw new BadRequestException('Results are published; the answer key cannot change any more');
    this.checkQuestions(dto.questions);
    const checked = await this.prisma.answer.count({ where: { submission: { testId } } });
    const version = t.keyVersion + 1;
    await this.prisma.$transaction(async (tx) => {
      const keep = new Set(dto.questions.map((q) => q.number));
      await tx.question.deleteMany({ where: { testId, number: { notIn: [...keep] } } });
      for (const q of dto.questions) {
        const data = questionData(q);
        await tx.question.upsert({ where: { testId_number: { testId, number: q.number } }, update: data, create: { ...data, testId } });
      }
      const rows = await tx.question.findMany({ where: { testId }, orderBy: { number: 'asc' } });
      await tx.answerKeyVersion.create({ data: { testId, version, questions: rows.map(publicQuestion) as object, confirmedById: teacherId } });
      await tx.test.update({
        where: { id: testId },
        data: { keyStatus: 'CONFIRMED', keyVersion: version, keyConfirmedAt: new Date(), totalMarks: rows.reduce((n, q) => n + q.maxMarks, 0) },
      });
    });
    await this.audit.record({ schoolId: t.assignment.subject.schoolId, actorId: teacherId, actorRole: 'TEACHER', action: 'answer-key.confirm', entity: 'test', entityId: testId, after: { version, questions: dto.questions.length } });
    let rechecking = 0;
    if (checked && dto.recheck) {
      const subs = await this.prisma.submission.findMany({ where: { testId, status: { in: ['CHECKED', 'NEEDS_REVIEW', 'FAILED'] } }, select: { id: true } });
      for (const s of subs) await this.checking.enqueue(s.id, 'bulk');
      rechecking = subs.length;
    }
    return { ...(await this.getKey(teacherId, testId)), rechecking };
  }

  // ---------- copies ----------

  async uploadCopy(teacherId: string, testId: string, studentId: string, files: Express.Multer.File[], mode: 'interactive' | 'bulk' = 'interactive') {
    const t = await this.ownTest(teacherId, testId);
    if (t.keyStatus !== 'CONFIRMED') throw new BadRequestException({ message: 'Confirm the answer key first, then upload copies.', code: 'KEY_NOT_CONFIRMED' });
    if (!files?.length) throw new BadRequestException('Add at least one page photo');
    for (const f of files) {
      if (!ALLOWED.has(f.mimetype) || !sniffImage(f.buffer)) throw new BadRequestException(`${f.originalname}: only JPG, PNG or WEBP photos are allowed`);
    }
    const student = await this.prisma.studentProfile.findUnique({ where: { id: studentId } });
    if (!student || student.sectionId !== t.assignment.sectionId || student.status !== 'ACTIVE') throw new NotFoundException('Student is not in this class');

    const existing = await this.prisma.submission.findUnique({ where: { testId_studentId: { testId, studentId } } });
    if (existing?.status === 'APPROVED') throw new BadRequestException('This copy is already approved');
    if (existing) this.assertNotChecking(existing);
    const sub = existing ?? (await this.prisma.submission.create({ data: { testId, studentId, schoolId: t.schoolId ?? t.assignment.subject.schoolId } }));

    await this.prisma.page.deleteMany({ where: { submissionId: sub.id } });
    await this.prisma.answer.deleteMany({ where: { submissionId: sub.id } });
    await this.prisma.problemCopy.updateMany({ where: { submissionId: sub.id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: teacherId } });
    await this.storage.removeDir(`submissions/${sub.id}`);
    let pageNo = 0;
    for (const f of files) {
      pageNo++;
      // re-encode on the server: upright, max 2400 px, and GPS/EXIF metadata removed
      const { data, width, height } = await normalizePage(f.buffer).catch(() => {
        throw new BadRequestException(`${f.originalname}: not a readable photo`);
      });
      const key = await this.storage.save(`submissions/${sub.id}/page-${pageNo}.jpg`, data);
      await this.prisma.page.create({ data: { submissionId: sub.id, pageNo, originalPath: key, testId, sha256: sha256Buffer(data), width, height } });
    }
    await this.prisma.submission.update({ where: { id: sub.id }, data: { obtainedMarks: null, aiSummary: null, checkedAt: null, qualityChecked: false, qualityOverride: false, schoolId: t.schoolId ?? t.assignment.subject.schoolId } });
    if (t.status === 'DRAFT') await this.prisma.test.update({ where: { id: testId }, data: { status: 'ACTIVE' } });
    await this.checking.enqueue(sub.id, mode);
    return { submissionId: sub.id, pages: pageNo, status: 'PENDING' };
  }

  async recheck(teacherId: string, submissionId: string) {
    const s = await this.ownSubmission(teacherId, submissionId);
    if (s.status === 'APPROVED') throw new BadRequestException('Approved copies cannot be re-checked');
    this.assertNotChecking(s);
    await this.checking.enqueue(submissionId);
    return { ok: true };
  }

  /** The teacher looked at the problem photo and wants the AI to check it as it is. */
  async checkAnyway(teacherId: string, submissionId: string) {
    const s = await this.ownSubmission(teacherId, submissionId);
    if (!['NEEDS_ATTENTION', 'FAILED'].includes(s.status)) throw new BadRequestException('This copy has no problem to skip');
    await this.prisma.problemCopy.updateMany({ where: { submissionId, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: teacherId } });
    await this.prisma.submission.update({ where: { id: submissionId }, data: { qualityOverride: true, qualityChecked: true } });
    await this.checking.enqueue(submissionId);
    return { ok: true };
  }

  async problems(teacherId: string, testId: string) {
    await this.ownTest(teacherId, testId);
    const rows = await this.prisma.problemCopy.findMany({
      where: { testId, resolvedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { submission: { select: { id: true, status: true, student: { select: { id: true, rollNo: true, name: true } } } } },
    });
    return rows.map((p) => ({
      id: p.id,
      type: p.type,
      pageNo: p.pageNo,
      details: p.details,
      createdAt: p.createdAt,
      submissionId: p.submissionId,
      status: p.submission.status,
      studentId: p.submission.student.id,
      studentName: p.submission.student.name,
      rollNo: p.submission.student.rollNo,
    }));
  }

  async dismissProblem(teacherId: string, problemId: string) {
    const p = await this.prisma.problemCopy.findUnique({ where: { id: problemId }, include: { test: { include: { assignment: true } } } });
    if (!p || p.test.assignment.teacherId !== teacherId) throw new NotFoundException('Problem not found');
    await this.prisma.problemCopy.update({ where: { id: problemId }, data: { resolvedAt: new Date(), resolvedById: teacherId } });
    return { ok: true };
  }

  async submission(teacherId: string, id: string) {
    await this.ownSubmission(teacherId, id);
    const s = await this.prisma.submission.findUniqueOrThrow({
      where: { id },
      include: {
        student: { select: { name: true, rollNo: true } },
        pages: { orderBy: { pageNo: 'asc' } },
        answers: true,
        problems: { where: { resolvedAt: null } },
        test: { include: { questions: { orderBy: { number: 'asc' } }, assignment: { include: { subject: true, section: { include: { schoolClass: true } } } } } },
      },
    });
    const roster = await this.prisma.submission.findMany({
      where: { testId: s.testId },
      orderBy: { student: { rollNo: 'asc' } },
      select: { id: true, status: true },
    });
    const idx = roster.findIndex((r) => r.id === id);
    const open = (r: { status: string }) => r.status === 'NEEDS_REVIEW' || r.status === 'CHECKED';
    const nextOpen = roster.slice(idx + 1).find((r) => r.status === 'NEEDS_REVIEW') ?? roster.slice(idx + 1).find(open) ?? null;
    return {
      id: s.id,
      status: s.status,
      obtainedMarks: s.obtainedMarks,
      aiSummary: s.aiSummary,
      error: s.error,
      approvedAt: s.approvedAt,
      notifiedAt: s.notifiedAt,
      model: s.model,
      keyVersion: s.keyVersion,
      voiceNoteUrl: this.storage.signedUrl(s.voiceNotePath),
      student: { id: s.studentId, name: s.student.name, rollNo: s.student.rollNo },
      test: { id: s.test.id, title: s.test.title, totalMarks: s.test.totalMarks, status: s.test.status, subject: s.test.assignment.subject.name, className: s.test.assignment.section.schoolClass.name, sectionName: s.test.assignment.section.name },
      problems: s.problems.map((p) => ({ id: p.id, type: p.type, pageNo: p.pageNo, details: p.details })),
      pages: s.pages.map((p) => ({ pageNo: p.pageNo, originalUrl: this.storage.signedUrl(p.originalPath), checkedUrl: this.storage.signedUrl(p.annotatedPath), flags: p.qualityFlags })),
      answers: s.test.questions.map((q) => {
        const a = s.answers.find((x) => x.questionId === q.id);
        const rules = ((q.rules as { id: string; text: string }[] | null) ?? []).filter((r) => a?.ruleIds.includes(r.id));
        return {
          id: a?.id ?? null,
          questionId: q.id,
          number: q.number,
          question: q.text,
          answerKey: q.answerKey,
          finalAnswer: q.finalAnswer,
          type: q.type,
          maxMarks: q.maxMarks,
          studentText: a?.transcription ?? null,
          transcription: a?.transcription ?? null,
          isBlank: a?.isBlank ?? false,
          legibility: a?.legibility ?? null,
          aiMarks: a?.aiMarks ?? null,
          finalMarks: a?.finalMarks ?? null,
          reason: a?.reason ?? null,
          comment: a?.comment ?? null,
          aiComment: a?.aiComment ?? null,
          confidence: a?.confidence ?? null,
          reviewState: a?.reviewState ?? null,
          needsReview: a?.needsReview ?? false,
          teacherEdited: a?.teacherEdited ?? false,
          overrideReason: a?.overrideReason ?? null,
          rulesApplied: rules,
          method: a?.method ?? null,
          samples: (a?.samples as number[] | null) ?? null,
          reviewedAt: a?.reviewedAt ?? null,
          pageNo: a?.pageNo ?? null,
          region: a?.region ?? null,
        };
      }),
      prevId: idx > 0 ? roster[idx - 1].id : null,
      nextId: idx >= 0 && idx < roster.length - 1 ? roster[idx + 1].id : null,
      nextNeedsReviewId: nextOpen?.id ?? null,
    };
  }

  async updateAnswer(teacherId: string, answerId: string, dto: UpdateAnswerDto) {
    const a = await this.prisma.answer.findUnique({ where: { id: answerId }, include: { question: true, submission: { include: { test: { include: { assignment: true } } } } } });
    if (!a || a.submission.test.assignment.teacherId !== teacherId) throw new NotFoundException('Answer not found');
    if (a.submission.status === 'APPROVED') throw new BadRequestException('This copy is already approved');
    if (a.submission.status === 'PENDING' || a.submission.status === 'PROCESSING') throw new BadRequestException('This copy is being checked right now. Wait a moment and try again.');
    if (dto.finalMarks !== undefined && dto.finalMarks > a.question.maxMarks) {
      throw new BadRequestException(`Marks cannot be more than ${a.question.maxMarks}`);
    }
    if (dto.finalMarks !== undefined && Math.round(dto.finalMarks * 2) !== dto.finalMarks * 2) throw new BadRequestException('Marks go in steps of 0.5');
    const previous = { finalMarks: a.finalMarks, comment: a.comment, overrideReason: a.overrideReason, teacherEdited: a.teacherEdited, needsReview: a.needsReview };
    if (dto.revert) {
      await this.prisma.answer.update({
        where: { id: answerId },
        data: { finalMarks: a.aiMarks, comment: a.aiComment ?? a.comment, teacherEdited: false, overrideReason: null, needsReview: a.reviewState !== 'SURE', reviewedAt: null },
      });
    } else {
      await this.prisma.answer.update({
        where: { id: answerId },
        data: {
          ...(dto.finalMarks !== undefined ? { finalMarks: dto.finalMarks } : {}),
          ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
          ...(dto.overrideReason !== undefined ? { overrideReason: dto.overrideReason || null } : {}),
          teacherEdited: true,
          needsReview: false,
          reviewedAt: new Date(),
        },
      });
    }
    await this.recalc(a.submissionId);
    const after = await this.prisma.answer.findUniqueOrThrow({ where: { id: answerId } });
    await this.audit.record({
      schoolId: a.submission.schoolId,
      actorId: teacherId,
      actorRole: 'TEACHER',
      action: dto.revert ? 'answer.revert' : 'answer.edit',
      entity: 'answer',
      entityId: answerId,
      before: { finalMarks: previous.finalMarks, comment: previous.comment },
      after: { finalMarks: after.finalMarks, comment: after.comment, aiMarks: after.aiMarks, question: a.question.number, submissionId: a.submissionId },
      reason: dto.overrideReason ?? null,
    });
    if (dto.comment && dto.comment !== a.aiComment && dto.comment.length <= 120) await this.useComment(teacherId, dto.comment);
    return { ...(await this.submission(teacherId, a.submissionId)), previous: { answerId, ...previous } };
  }

  /** Marks the open "Check" items of a copy as looked at without changing marks. */
  async confirmAnswer(teacherId: string, answerId: string) {
    const a = await this.prisma.answer.findUnique({ where: { id: answerId }, include: { submission: { include: { test: { include: { assignment: true } } } } } });
    if (!a || a.submission.test.assignment.teacherId !== teacherId) throw new NotFoundException('Answer not found');
    if (a.submission.status === 'APPROVED') throw new BadRequestException('This copy is already approved');
    await this.prisma.answer.update({ where: { id: answerId }, data: { needsReview: false, reviewedAt: new Date() } });
    await this.recalc(a.submissionId);
    return this.submission(teacherId, a.submissionId);
  }

  private async recalc(submissionId: string) {
    const [sum, open] = await Promise.all([
      this.prisma.answer.aggregate({ where: { submissionId }, _sum: { finalMarks: true } }),
      this.prisma.answer.count({ where: { submissionId, needsReview: true } }),
    ]);
    const sub = await this.prisma.submission.findUniqueOrThrow({ where: { id: submissionId } });
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        obtainedMarks: round1(sum._sum.finalMarks ?? 0),
        ...(sub.status === 'NEEDS_REVIEW' && !open ? { status: 'CHECKED' } : {}),
        ...(sub.status === 'CHECKED' && open ? { status: 'NEEDS_REVIEW' } : {}),
      },
    });
  }

  private async approveOne(submissionId: string, actorId?: string) {
    await this.prisma.answer.updateMany({ where: { submissionId }, data: { needsReview: false } });
    await this.recalc(submissionId);
    const edited = await this.prisma.answer.count({ where: { submissionId, teacherEdited: true } });
    if (edited) await this.checking.reannotate(submissionId);
    const s = await this.prisma.submission.update({ where: { id: submissionId }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await this.bumpStats(submissionId, +1);
    await this.audit.record({ schoolId: s.schoolId, actorId, actorRole: 'TEACHER', action: 'copy.approve', entity: 'submission', entityId: submissionId, after: { obtainedMarks: s.obtainedMarks } });
  }

  /**
   * Keeps per-test counters (approved copies, sum of percentages, marks per question) so dashboards
   * never COUNT or AVG big tables. Runs once per approval (+1) or un-approval (-1).
   */
  private async bumpStats(submissionId: string, dir: 1 | -1) {
    const s = await this.prisma.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { test: true, answers: { include: { question: true } } } });
    const pct = s.test.totalMarks ? ((s.obtainedMarks ?? 0) / s.test.totalMarks) * 100 : 0;
    await this.prisma.$transaction(async (tx) => {
      const cur = await tx.testStats.upsert({ where: { testId: s.testId }, update: {}, create: { testId: s.testId } });
      const per = { ...(cur.perQuestion as Record<string, { sum: number; max: number; n: number }>) };
      for (const a of s.answers) {
        const k = String(a.question.number);
        const row = per[k] ?? { sum: 0, max: a.question.maxMarks, n: 0 };
        per[k] = { sum: round1(row.sum + dir * (a.finalMarks ?? 0)), max: a.question.maxMarks, n: Math.max(0, row.n + dir) };
      }
      await tx.testStats.update({ where: { testId: s.testId }, data: { approved: { increment: dir }, sumPercent: { increment: dir * pct }, perQuestion: per } });
    });
  }

  async approve(teacherId: string, submissionId: string) {
    const s = await this.ownSubmission(teacherId, submissionId);
    if (!['CHECKED', 'NEEDS_REVIEW'].includes(s.status)) throw new BadRequestException('Only checked copies can be approved');
    await this.approveOne(submissionId, teacherId);
    if (s.test.status === 'PUBLISHED') await this.announce(s.testId, [submissionId]);
    return this.submission(teacherId, submissionId);
  }

  /** "Approve all Sure copies": every answer was SURE (status CHECKED). Returns ids so the app can undo. */
  async approveAllChecked(teacherId: string, testId: string) {
    const t = await this.ownTest(teacherId, testId);
    const subs = await this.prisma.submission.findMany({ where: { testId, status: 'CHECKED' }, select: { id: true } });
    for (const s of subs) await this.approveOne(s.id, teacherId);
    if (t.status === 'PUBLISHED') await this.announce(testId, subs.map((s) => s.id));
    return { approved: subs.length, ids: subs.map((s) => s.id) };
  }

  /** Undo an approval, as long as nobody has been told about the result yet. */
  async unapprove(teacherId: string, ids: string[]) {
    let undone = 0;
    for (const id of ids) {
      const s = await this.ownSubmission(teacherId, id);
      if (s.status !== 'APPROVED' || s.notifiedAt) continue;
      // answers the teacher never looked at go back to "Check"
      const unseen = { submissionId: id, reviewState: { not: 'SURE' as const }, reviewedAt: null };
      const open = await this.prisma.answer.count({ where: unseen });
      await this.prisma.submission.update({ where: { id }, data: { status: open ? 'NEEDS_REVIEW' : 'CHECKED', approvedAt: null } });
      if (open) await this.prisma.answer.updateMany({ where: unseen, data: { needsReview: true } });
      await this.bumpStats(id, -1);
      await this.audit.record({ schoolId: s.schoolId, actorId: teacherId, actorRole: 'TEACHER', action: 'copy.unapprove', entity: 'submission', entityId: id });
      undone++;
    }
    return { undone };
  }

  async publish(teacherId: string, testId: string) {
    const t = await this.ownTest(teacherId, testId);
    const approved = await this.prisma.submission.count({ where: { testId, status: 'APPROVED' } });
    if (!approved) throw new BadRequestException('Approve at least one copy before publishing results');
    if (t.status !== 'PUBLISHED') await this.prisma.test.update({ where: { id: testId }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    await this.audit.record({ schoolId: t.assignment.subject.schoolId, actorId: teacherId, actorRole: 'TEACHER', action: 'test.publish', entity: 'test', entityId: testId, after: { approved } });
    const fresh = await this.prisma.submission.findMany({ where: { testId, status: 'APPROVED', notifiedAt: null }, select: { id: true } });
    await this.announce(testId, fresh.map((s) => s.id));
    return { published: approved, notified: fresh.length };
  }

  /** Notifies students (bell + push) and emails guardians once results are visible. */
  private async announce(testId: string, submissionIds: string[]) {
    if (!submissionIds.length) return;
    const subs = await this.prisma.submission.findMany({
      where: { id: { in: submissionIds }, notifiedAt: null },
      include: {
        student: { include: { user: true, section: { include: { schoolClass: true } }, guardians: { include: { guardian: true } } } },
        test: { include: { assignment: { include: { subject: true } } } },
      },
    });
    for (const s of subs) {
      const subject = s.test.assignment.subject.name;
      const marks = `${s.obtainedMarks ?? 0}/${s.test.totalMarks}`;
      const name = s.student.name;
      const link = this.share.url(s.id);
      // parents: bell + push in the app, and a WhatsApp/SMS message with the copy link (works without the app)
      const parentUsers = s.student.guardians.map((g) => g.guardian.userId).filter(Boolean) as string[];
      if (parentUsers.length) {
        await this.notifications.notify(parentUsers, { type: 'RESULT', title: `${name}: ${subject} result`, body: `${name} scored ${marks} in ${s.test.title}.`, data: { submissionId: s.id, studentId: s.studentId } });
      }
      for (const phone of new Set(s.student.guardians.map((g) => g.guardian.phone))) {
        await this.messaging.sendResult(phone, { student: name, className: `${s.student.section.schoolClass.name} ${s.student.section.name}`, test: `${subject}: ${s.test.title}`, marks, link });
      }
      if (s.student.userId) {
        await this.notifications.notify([s.student.userId], {
          type: 'RESULT',
          title: `Result: ${s.test.title}`,
          body: `You scored ${marks} in ${subject}. Tap to see your checked copy.`,
          data: { submissionId: s.id },
        });
      }
      if (s.student.guardianEmail) {
        await this.mail.send({
          to: s.student.guardianEmail,
          toName: s.student.guardianName ?? undefined,
          subject: `${name}: ${subject} result (${marks})`,
          heading: `${subject} — ${s.test.title}`,
          paragraphs: [
            `Assalam o Alaikum ${s.student.guardianName ?? 'Parent'},`,
            `${name} scored ${marks} in ${s.test.title}.`,
            s.aiSummary ? `Teacher's note: ${s.aiSummary}` : 'The checked copy with comments is available in the LaalPen app.',
          ],
          button: { label: 'See the checked copy', url: link },
        });
      }
      await this.prisma.submission.update({ where: { id: s.id }, data: { notifiedAt: new Date() } });
    }
  }

  // ---------- comment bank ----------

  private static DEFAULT_COMMENTS = [
    { text: 'Unit missing', lang: 'en' }, { text: 'Show your working', lang: 'en' }, { text: 'Formula is correct', lang: 'en' },
    { text: 'Calculation mistake', lang: 'en' }, { text: 'Incomplete answer', lang: 'en' }, { text: 'Well done!', lang: 'en' },
    { text: 'یونٹ لکھیں', lang: 'ur' }, { text: 'طریقہ درست ہے', lang: 'ur' }, { text: 'جواب نامکمل ہے', lang: 'ur' }, { text: 'شاباش!', lang: 'ur' },
  ];

  /** The teacher's comments, most used first (starts with a few common English + Urdu ones). */
  async comments(teacherId: string, q?: string) {
    const count = await this.prisma.commentBank.count({ where: { teacherId } });
    if (!count) await this.prisma.commentBank.createMany({ data: TeacherService.DEFAULT_COMMENTS.map((c) => ({ ...c, teacherId })), skipDuplicates: true });
    return this.prisma.commentBank.findMany({
      where: { teacherId, ...(q ? { text: { contains: q, mode: 'insensitive' as const } } : {}) },
      orderBy: [{ uses: 'desc' }, { lastUsedAt: 'desc' }],
      take: 30,
      select: { id: true, text: true, lang: true, uses: true },
    });
  }

  async addComment(teacherId: string, text: string, lang = 'en') {
    return this.prisma.commentBank.upsert({ where: { teacherId_text: { teacherId, text } }, update: { lang }, create: { teacherId, text, lang } });
  }

  async deleteComment(teacherId: string, id: string) {
    await this.prisma.commentBank.deleteMany({ where: { id, teacherId } });
    return { ok: true };
  }

  private async useComment(teacherId: string, text: string) {
    const lang = /[\u0600-\u06FF]/.test(text) ? 'ur' : 'en';
    await this.prisma.commentBank.upsert({ where: { teacherId_text: { teacherId, text } }, update: { uses: { increment: 1 }, lastUsedAt: new Date() }, create: { teacherId, text, lang, uses: 1 } });
  }

  // ---------- grade by question ----------

  /**
   * One question across the whole class (Gradescope-style): every student's answer with the AI mark,
   * the page region to zoom into, and groups of identical answers that can be approved together.
   */
  async byQuestion(teacherId: string, testId: string, number: number) {
    const t = await this.ownTest(teacherId, testId);
    const q = t.questions.find((x) => x.number === number);
    if (!q) throw new NotFoundException('Question not found');
    const answers = await this.prisma.answer.findMany({
      where: { questionId: q.id, submission: { testId } },
      include: { submission: { select: { id: true, status: true, student: { select: { id: true, name: true, rollNo: true } }, pages: { select: { pageNo: true, originalPath: true, annotatedPath: true } } } } },
      orderBy: { submission: { student: { rollNo: 'asc' } } },
    });
    const norm = (x: string | null) => (x ?? '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff.=/]+/g, ' ').trim();
    const groups = new Map<string, string[]>();
    for (const a of answers) {
      const key = a.isBlank ? '(blank)' : norm(a.transcription);
      if (key && key.length <= 60) groups.set(key, [...(groups.get(key) ?? []), a.id]);
    }
    const groupOf = new Map<string, string>();
    for (const [k, ids] of groups) if (ids.length > 1) for (const id of ids) groupOf.set(id, k);
    return {
      test: { id: t.id, title: t.title, status: t.status, questionCount: t.questions.length },
      question: publicQuestion(q),
      answers: answers.map((a) => {
        const page = a.submission.pages.find((p) => p.pageNo === (a.pageNo ?? 1)) ?? a.submission.pages[0];
        return {
          id: a.id,
          submissionId: a.submission.id,
          submissionStatus: a.submission.status,
          student: a.submission.student,
          studentText: a.transcription,
          isBlank: a.isBlank,
          aiMarks: a.aiMarks,
          finalMarks: a.finalMarks,
          reason: a.reason,
          comment: a.comment,
          reviewState: a.reviewState,
          needsReview: a.needsReview,
          teacherEdited: a.teacherEdited,
          region: a.region,
          imageUrl: this.storage.signedUrl(page?.annotatedPath ?? page?.originalPath),
          group: groupOf.get(a.id) ?? null,
        };
      }),
      groups: [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([text, ids]) => ({ text, count: ids.length, answerIds: ids })),
    };
  }

  /** Same mark (and comment) for a group of identical answers, in one tap. */
  async markGroup(teacherId: string, testId: string, answerIds: string[], finalMarks: number, comment?: string) {
    const t = await this.ownTest(teacherId, testId);
    const rows = await this.prisma.answer.findMany({ where: { id: { in: answerIds }, submission: { testId } }, include: { question: true, submission: true } });
    if (rows.length !== answerIds.length) throw new NotFoundException('Some answers were not found');
    if (rows.some((r) => r.submission.status === 'APPROVED')) throw new BadRequestException('Some of these copies are already approved');
    if (rows.some((r) => finalMarks > r.question.maxMarks)) throw new BadRequestException('Marks are more than the question allows');
    for (const r of rows) await this.updateAnswer(teacherId, r.id, { finalMarks, ...(comment !== undefined ? { comment } : {}), overrideReason: 'Grouped answer' });
    void t;
    return { updated: rows.length };
  }

  // ---------- after publishing ----------

  /**
   * Re-open an approved copy (a parent disputed the marks). Needs a fresh password/authenticator check,
   * a reason, is written to the audit log and the principal is told.
   */
  async reopen(teacher: AuthUser, submissionId: string, reason: string) {
    const s = await this.ownSubmission(teacher.id, submissionId);
    if (s.status !== 'APPROVED') throw new BadRequestException('Only approved copies can be re-opened');
    if (!reason?.trim()) throw new BadRequestException('Write why the marks need to change');
    await this.prisma.submission.update({ where: { id: submissionId }, data: { status: 'CHECKED', approvedAt: null, notifiedAt: null } });
    await this.bumpStats(submissionId, -1);
    await this.audit.record({ schoolId: s.schoolId, actorId: teacher.id, actorRole: 'TEACHER', action: 'copy.reopen', entity: 'submission', entityId: submissionId, reason, ip: teacher.ip });
    const admins = await this.prisma.user.findMany({ where: { schoolId: s.schoolId ?? undefined, role: 'ADMIN', isActive: true }, select: { id: true } });
    const info = await this.prisma.submission.findUniqueOrThrow({ where: { id: submissionId }, include: { student: true, test: { include: { assignment: { include: { teacher: { select: { name: true } } } } } } } });
    await this.notifications.notify(admins.map((a) => a.id), {
      type: 'INFO',
      title: 'Published marks re-opened',
      body: `${info.test.assignment.teacher.name} re-opened ${info.student.name}'s copy in ${info.test.title}: "${reason.slice(0, 120)}"`,
      data: { submissionId },
    });
    return this.submission(teacher.id, submissionId);
  }

  /** "Mark history": every change to this copy, who made it and why. */
  async history(teacherId: string, submissionId: string) {
    await this.ownSubmission(teacherId, submissionId);
    const answers = await this.prisma.answer.findMany({ where: { submissionId }, select: { id: true } });
    return this.audit.history([submissionId, ...answers.map((a) => a.id)]);
  }

  /** Overnight test, but this one copy is needed now. */
  async checkNow(teacherId: string, submissionId: string) {
    const s = await this.ownSubmission(teacherId, submissionId);
    if (!['PENDING', 'FAILED', 'NEEDS_ATTENTION'].includes(s.status) || s.aiBatchId) throw new BadRequestException('This copy is not waiting');
    await this.checking.enqueue(submissionId, 'interactive', true);
    return { ok: true };
  }

  /** Teacher's short voice note for the student / parent (m4a, mp3, webm or ogg, max 2 MB). */
  async saveVoiceNote(teacherId: string, submissionId: string, file: Express.Multer.File) {
    await this.ownSubmission(teacherId, submissionId);
    const ok = ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/wav'];
    if (!file || !ok.includes(file.mimetype)) throw new BadRequestException('Record an audio note (m4a, mp3, webm or ogg)');
    if (file.size > 2 * 1024 * 1024) throw new BadRequestException('Keep the voice note under 2 MB (about 2 minutes)');
    const ext = file.mimetype.includes('webm') ? 'webm' : file.mimetype.includes('ogg') ? 'ogg' : file.mimetype.includes('mpeg') ? 'mp3' : file.mimetype.includes('wav') ? 'wav' : 'm4a';
    const key = `submissions/${submissionId}/voice-${Date.now()}.${ext}`;
    await this.storage.save(key, file.buffer, file.mimetype);
    await this.prisma.submission.update({ where: { id: submissionId }, data: { voiceNotePath: key } });
    return { ok: true, url: this.storage.signedUrl(key) };
  }

}

