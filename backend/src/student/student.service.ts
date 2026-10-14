import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { round1 } from '../common/util.js';

const visible = { status: 'APPROVED' as const, test: { status: 'PUBLISHED' as const } };

export interface StudentRef {
  id: string;
  schoolId: string;
  sectionId: string;
  name: string;
  rollNo: string;
}

/**
 * What a student (or their parent) sees: only approved copies of published tests.
 * Every read runs inside TenantService.read, so PostgreSQL row-level security only returns
 * rows of the student's own school.
 */
@Injectable()
export class StudentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenant: TenantService,
  ) {}

  /** The roster record linked to a student account. */
  async profileForUser(userId: string): Promise<StudentRef> {
    const p = await this.prisma.studentProfile.findUnique({ where: { userId }, select: { id: true, schoolId: true, sectionId: true, name: true, rollNo: true } });
    if (!p) throw new ForbiddenException({ message: 'Your teacher has not approved your account yet.', code: 'ENROLLMENT_PENDING' });
    return p;
  }

  async dashboard(p: StudentRef) {
    return this.tenant.read(p.schoolId, async (tx) => {
      const [profile, assignments, results] = await Promise.all([
        tx.studentProfile.findUniqueOrThrow({ where: { id: p.id }, include: { section: { include: { schoolClass: true } } } }),
        tx.teachingAssignment.findMany({
          where: { sectionId: p.sectionId },
          include: { subject: true, teacher: { select: { name: true } } },
          orderBy: { subject: { name: 'asc' } },
        }),
        tx.submission.findMany({
          where: { studentId: p.id, ...visible },
          orderBy: [{ test: { publishedAt: 'desc' } }, { id: 'desc' }],
          include: { test: { include: { assignment: { include: { subject: true } } } } },
        }),
      ]);
      const pct = (r: (typeof results)[number]) => (r.test.totalMarks ? ((r.obtainedMarks ?? 0) / r.test.totalMarks) * 100 : 0);
      const avg = (rs: typeof results) => (rs.length ? round1(rs.reduce((n, r) => n + pct(r), 0) / rs.length) : null);
      const trendRows = results.slice(0, 12).reverse();
      const last = results[0];
      const prevSame = last ? results.slice(1).find((r) => r.test.assignment.subjectId === last.test.assignment.subjectId) : undefined;
      return {
        student: { id: p.id, name: profile.name, rollNo: profile.rollNo, className: profile.section.schoolClass.name, sectionName: profile.section.name },
        stats: {
          results: results.length,
          average: avg(results),
          best: results.length ? round1(Math.max(...results.map(pct))) : null,
          subjects: assignments.length,
          // change since the previous test of the same subject (growth, not rank)
          lastChange: last && prevSame ? round1(pct(last) - pct(prevSame)) : null,
        },
        subjects: assignments.map((a) => {
          const rs = results.filter((r) => r.test.assignmentId === a.id);
          return { assignmentId: a.id, subject: a.subject.name, color: a.subject.color, teacher: a.teacher.name, results: rs.length, average: avg(rs) };
        }),
        recentResults: results.slice(0, 8).map((r) => this.resultRow(r)),
        trend: trendRows.map((r) => ({ title: r.test.title, subject: r.test.assignment.subject.name, percent: round1(pct(r)) })),
      };
    });
  }

  private resultRow(r: any) {
    return {
      submissionId: r.id,
      title: r.test.title,
      subject: r.test.assignment.subject.name,
      color: r.test.assignment.subject.color,
      obtained: r.obtainedMarks ?? 0,
      total: r.test.totalMarks,
      percent: r.test.totalMarks ? round1(((r.obtainedMarks ?? 0) / r.test.totalMarks) * 100) : 0,
      testDate: r.test.testDate,
      publishedAt: r.test.publishedAt,
    };
  }

  async subject(p: StudentRef, assignmentId: string) {
    return this.tenant.read(p.schoolId, async (tx) => {
      const a = await tx.teachingAssignment.findUnique({ where: { id: assignmentId }, include: { subject: true, teacher: { select: { name: true } } } });
      if (!a) throw new NotFoundException('Subject not found');
      const results = await tx.submission.findMany({
        where: { studentId: p.id, ...visible, test: { status: 'PUBLISHED', assignmentId } },
        orderBy: [{ test: { testDate: 'desc' } }, { id: 'desc' }],
        include: { test: { include: { assignment: { include: { subject: true } } } } },
      });
      if (a.sectionId !== p.sectionId && !results.length) throw new NotFoundException('Subject not found');
      const rows = results.map((r) => this.resultRow(r));
      return {
        assignmentId,
        subject: a.subject.name,
        color: a.subject.color,
        teacher: a.teacher.name,
        average: rows.length ? round1(rows.reduce((n, r) => n + r.percent, 0) / rows.length) : null,
        results: rows,
      };
    });
  }

  async result(p: StudentRef, submissionId: string) {
    return this.tenant.read(p.schoolId, async (tx) => {
      const s = await tx.submission.findUnique({
        where: { id: submissionId },
        include: {
          pages: { orderBy: { pageNo: 'asc' } },
          answers: { include: { question: true } },
          test: { include: { assignment: { include: { subject: true, teacher: { select: { name: true } }, section: { include: { schoolClass: true } } } } } },
        },
      });
      if (!s || s.studentId !== p.id || s.status !== 'APPROVED' || s.test.status !== 'PUBLISHED') throw new NotFoundException('Result not found');
      const answers = s.answers.sort((a, b) => a.question.number - b.question.number);
      // one strength and one thing to practise, from the topics of the questions
      const scored = answers.map((a) => ({ topic: a.question.topic ?? `Q${a.question.number}`, ratio: a.question.maxMarks ? (a.finalMarks ?? 0) / a.question.maxMarks : 0 }));
      const best = [...scored].sort((a, b) => b.ratio - a.ratio)[0];
      const weak = [...scored].sort((a, b) => a.ratio - b.ratio)[0];
      return {
        id: s.id,
        student: { name: p.name, rollNo: p.rollNo, className: s.test.assignment.section.schoolClass.name, sectionName: s.test.assignment.section.name },
        title: s.test.title,
        subject: s.test.assignment.subject.name,
        color: s.test.assignment.subject.color,
        teacher: s.test.assignment.teacher.name,
        testDate: s.test.testDate,
        obtained: s.obtainedMarks ?? 0,
        total: s.test.totalMarks,
        percent: s.test.totalMarks ? round1(((s.obtainedMarks ?? 0) / s.test.totalMarks) * 100) : 0,
        summary: s.aiSummary,
        strength: best && best.ratio >= 0.7 ? best.topic : null,
        practise: weak && weak.ratio < 0.7 ? weak.topic : null,
        voiceNoteUrl: this.storage.signedUrl(s.voiceNotePath),
        pages: s.pages.map((pg) => ({ pageNo: pg.pageNo, url: this.storage.signedUrl(pg.annotatedPath ?? pg.originalPath), originalUrl: this.storage.signedUrl(pg.originalPath) })),
        answers: answers.map((a) => ({ number: a.question.number, question: a.question.text, topic: a.question.topic, maxMarks: a.question.maxMarks, marks: a.finalMarks ?? 0, comment: a.comment, reason: a.reason, pageNo: a.pageNo })),
      };
    });
  }

  /** Paged result history (newest first, keyset cursor) — for students with years of tests. */
  async history(p: StudentRef, cursor?: string, take = 20) {
    return this.tenant.read(p.schoolId, async (tx) => {
      const rows = await tx.submission.findMany({
        where: { studentId: p.id, ...visible },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(take, 50),
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        include: { test: { include: { assignment: { include: { subject: true } } } } },
      });
      return { items: rows.map((r) => this.resultRow(r)), nextCursor: rows.length === Math.min(take, 50) ? rows.at(-1)!.id : null };
    });
  }
}
