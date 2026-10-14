import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service.js';
import { CardsService } from '../roster/cards.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RosterService } from '../roster/roster.service.js';
import { round1 } from '../common/util.js';
import type { AuthUser } from '../common/decorators.js';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Principal's view: is checking keeping up (turnaround, what is waiting where), how classes are doing,
 * and which topics need re-teaching (topic × class heatmap). All plain SQL aggregates on indexed columns —
 * one round trip per block, no per-student loops.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: CardsService,
    private readonly audit: AuditService,
    private readonly roster: RosterService,
  ) {}

  async insights(schoolId: string, days = 30) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);

    const [turn] = await this.prisma.$queryRaw<{ ai_h: number | null; teacher_h: number | null; total_h: number | null; copies: bigint }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s."checkedAt" - s."createdAt")) / 3600) AS ai_h,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s."approvedAt" - s."checkedAt")) / 3600) FILTER (WHERE s."approvedAt" IS NOT NULL) AS teacher_h,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s."approvedAt" - s."createdAt")) / 3600) FILTER (WHERE s."approvedAt" IS NOT NULL) AS total_h,
             count(*) AS copies
        FROM "submissions" s
       WHERE s."schoolId" = ${schoolId} AND s."createdAt" >= ${since} AND s."checkedAt" IS NOT NULL`;

    const statusRows = await this.prisma.$queryRaw<{ status: string; n: bigint }[]>`
      SELECT s."status"::text AS status, count(*) AS n FROM "submissions" s WHERE s."schoolId" = ${schoolId} GROUP BY 1`;
    const by = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)]));

    const teachers = await this.prisma.$queryRaw<{ id: string; name: string; tests: bigint; copies: bigint; waiting: bigint; problems: bigint; turnaround_h: number | null; edited: bigint; answers: bigint }[]>`
      SELECT u."id", u."name",
             count(DISTINCT t."id") AS tests,
             count(s."id") FILTER (WHERE s."createdAt" >= ${since}) AS copies,
             count(s."id") FILTER (WHERE s."status" IN ('CHECKED', 'NEEDS_REVIEW')) AS waiting,
             count(s."id") FILTER (WHERE s."status" IN ('NEEDS_ATTENTION', 'FAILED')) AS problems,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s."approvedAt" - s."createdAt")) / 3600) FILTER (WHERE s."approvedAt" >= ${since}) AS turnaround_h,
             (SELECT count(*) FROM "answers" a JOIN "submissions" s2 ON s2."id" = a."submissionId" JOIN "tests" t2 ON t2."id" = s2."testId" JOIN "teaching_assignments" ta2 ON ta2."id" = t2."assignmentId"
               WHERE ta2."teacherId" = u."id" AND a."teacherEdited" AND s2."createdAt" >= ${since}) AS edited,
             (SELECT count(*) FROM "answers" a JOIN "submissions" s2 ON s2."id" = a."submissionId" JOIN "tests" t2 ON t2."id" = s2."testId" JOIN "teaching_assignments" ta2 ON ta2."id" = t2."assignmentId"
               WHERE ta2."teacherId" = u."id" AND s2."createdAt" >= ${since}) AS answers
        FROM "users" u
        LEFT JOIN "teaching_assignments" ta ON ta."teacherId" = u."id"
        LEFT JOIN "tests" t ON t."assignmentId" = ta."id"
        LEFT JOIN "submissions" s ON s."testId" = t."id"
       WHERE u."schoolId" = ${schoolId} AND u."role" = 'TEACHER' AND u."isActive"
       GROUP BY u."id", u."name"
       ORDER BY waiting DESC, u."name"`;

    const classes = await this.prisma.$queryRaw<{ section_id: string; class_name: string; section_name: string; grade: number; tests: bigint; average: number | null; students: bigint }[]>`
      SELECT sec."id" AS section_id, c."name" AS class_name, sec."name" AS section_name, c."grade",
             count(DISTINCT t."id") FILTER (WHERE t."status" = 'PUBLISHED') AS tests,
             avg(s."obtainedMarks" / NULLIF(t."totalMarks", 0) * 100) FILTER (WHERE s."status" = 'APPROVED') AS average,
             (SELECT count(*) FROM "student_profiles" p WHERE p."sectionId" = sec."id" AND p."status" = 'ACTIVE') AS students
        FROM "sections" sec
        JOIN "classes" c ON c."id" = sec."classId"
        LEFT JOIN "teaching_assignments" ta ON ta."sectionId" = sec."id"
        LEFT JOIN "tests" t ON t."assignmentId" = ta."id"
        LEFT JOIN "submissions" s ON s."testId" = t."id"
       WHERE c."schoolId" = ${schoolId}
       GROUP BY sec."id", c."name", sec."name", c."grade"
       ORDER BY c."grade", c."name", sec."name"`;

    // topic × section: average % of the marks on questions of that topic (approved copies)
    const cells = await this.prisma.$queryRaw<{ section_id: string; subject: string; topic: string; pct: number; answers: bigint }[]>`
      SELECT ta."sectionId" AS section_id, sub."name" AS subject, COALESCE(NULLIF(q."topic", ''), 'Q' || q."number"::text || ' ' || left(t."title", 24)) AS topic,
             avg(a."finalMarks" / NULLIF(q."maxMarks", 0) * 100) AS pct, count(*) AS answers
        FROM "answers" a
        JOIN "submissions" s ON s."id" = a."submissionId" AND s."status" = 'APPROVED'
        JOIN "questions" q ON q."id" = a."questionId"
        JOIN "tests" t ON t."id" = s."testId"
        JOIN "teaching_assignments" ta ON ta."id" = t."assignmentId"
        JOIN "subjects" sub ON sub."id" = ta."subjectId"
       WHERE s."schoolId" = ${schoolId} AND s."approvedAt" >= ${since}
       GROUP BY 1, 2, 3
      HAVING count(*) >= 1`;

    const topics = [...new Map(cells.map((c) => [`${c.subject}|${c.topic}`, { subject: c.subject, topic: c.topic }])).values()].sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
    const weakest = [...cells].sort((a, b) => a.pct - b.pct).slice(0, 5);
    const sectionName = new Map(classes.map((c) => [c.section_id, `${c.class_name} ${c.section_name}`]));

    return {
      days,
      turnaround: { aiHours: round1(num(turn?.ai_h) ?? 0), teacherHours: num(turn?.teacher_h) === null ? null : round1(num(turn?.teacher_h)!), totalHours: num(turn?.total_h) === null ? null : round1(num(turn?.total_h)!), copies: Number(turn?.copies ?? 0) },
      pending: {
        checking: (by.PENDING ?? 0) + (by.PROCESSING ?? 0),
        withTeachers: (by.CHECKED ?? 0) + (by.NEEDS_REVIEW ?? 0),
        problems: (by.NEEDS_ATTENTION ?? 0) + (by.FAILED ?? 0),
        approved: by.APPROVED ?? 0,
      },
      teachers: teachers.map((t) => ({
        id: t.id, name: t.name, tests: Number(t.tests), copies: Number(t.copies), waiting: Number(t.waiting), problems: Number(t.problems),
        turnaroundHours: num(t.turnaround_h) === null ? null : round1(num(t.turnaround_h)!),
        changedByTeacher: Number(t.answers) ? round1((Number(t.edited) / Number(t.answers)) * 100) : null,
      })),
      classes: classes.map((c) => ({ sectionId: c.section_id, name: `${c.class_name} ${c.section_name}`, students: Number(c.students), tests: Number(c.tests), average: num(c.average) === null ? null : round1(num(c.average)!) })),
      heatmap: {
        sections: classes.filter((c) => cells.some((x) => x.section_id === c.section_id)).map((c) => ({ id: c.section_id, name: `${c.class_name} ${c.section_name}` })),
        topics,
        cells: cells.map((c) => ({ sectionId: c.section_id, subject: c.subject, topic: c.topic, percent: round1(Number(c.pct)), answers: Number(c.answers) })),
      },
      weakest: weakest.map((c) => ({ section: sectionName.get(c.section_id) ?? '', subject: c.subject, topic: c.topic, percent: round1(Number(c.pct)) })),
    };
  }

  // ---------- exports (board SBA / ERP) ----------

  private async rows(schoolId: string, sessionId?: string) {
    const session = sessionId ? await this.prisma.academicSession.findFirst({ where: { id: sessionId, schoolId } }) : await this.roster.currentSession(schoolId);
    if (!session) throw new BadRequestException('Session not found');
    const subs = await this.prisma.submission.findMany({
      where: { schoolId, status: 'APPROVED', test: { status: 'PUBLISHED', OR: [{ sessionId: session.id }, { sessionId: null }] } },
      include: { student: { include: { section: { include: { schoolClass: true } } } }, test: { include: { assignment: { include: { subject: true, section: { include: { schoolClass: true } } } } } } },
      orderBy: [{ test: { testDate: 'asc' } }],
    });
    return {
      session,
      rows: subs.map((s) => ({
        admissionNo: s.student.admissionNo ?? '',
        name: s.student.name,
        fatherName: s.student.fatherName ?? '',
        className: s.test.assignment.section.schoolClass.name,
        section: s.test.assignment.section.name,
        rollNo: s.student.rollNo,
        subject: s.test.assignment.subject.name,
        test: s.test.title,
        date: s.test.testDate.toISOString().slice(0, 10),
        marks: s.obtainedMarks ?? 0,
        total: s.test.totalMarks,
        percent: s.test.totalMarks ? round1(((s.obtainedMarks ?? 0) / s.test.totalMarks) * 100) : 0,
      })),
    };
  }

  async export(actor: AuthUser, format: 'xlsx' | 'csv', sessionId?: string) {
    const schoolId = actor.schoolId!;
    const { session, rows } = await this.rows(schoolId, sessionId);
    const head = ['Admission No', 'Name', 'Father Name', 'Class', 'Section', 'Roll No', 'Subject', 'Test', 'Date', 'Marks', 'Total', 'Percent'];
    const values = (r: (typeof rows)[number]) => [r.admissionNo, r.name, r.fatherName, r.className, r.section, r.rollNo, r.subject, r.test, r.date, r.marks, r.total, r.percent];
    let data: Buffer;
    let type: string;
    if (format === 'csv') {
      const esc = (v: unknown) => {
        const s = String(v ?? '');
        return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; // no formula injection in Excel
      };
      data = Buffer.from(`﻿${[head, ...rows.map(values)].map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`, 'utf8');
      type = 'text/csv';
    } else {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'LaalPen';
      const ws = wb.addWorksheet('Results', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.addRow(head).font = { bold: true };
      for (const r of rows) ws.addRow(values(r));
      ws.columns.forEach((c, i) => (c.width = [14, 24, 22, 10, 8, 8, 16, 28, 12, 8, 8, 9][i]));
      // one row per student, one column per subject: the average % (what board SBA portals ask for)
      const subjects = [...new Set(rows.map((r) => r.subject))].sort();
      const per = new Map<string, { r: (typeof rows)[number]; marks: Map<string, number[]> }>();
      for (const r of rows) {
        const key = `${r.className}|${r.section}|${r.rollNo}|${r.name}`;
        const e = per.get(key) ?? { r, marks: new Map() };
        e.marks.set(r.subject, [...(e.marks.get(r.subject) ?? []), r.percent]);
        per.set(key, e);
      }
      const ss = wb.addWorksheet('Subject averages', { views: [{ state: 'frozen', ySplit: 1 }] });
      ss.addRow(['Admission No', 'Name', 'Class', 'Section', 'Roll No', ...subjects]).font = { bold: true };
      for (const { r, marks } of per.values()) {
        ss.addRow([r.admissionNo, r.name, r.className, r.section, r.rollNo, ...subjects.map((s) => (marks.has(s) ? round1(marks.get(s)!.reduce((a, b) => a + b, 0) / marks.get(s)!.length) : null))]);
      }
      data = Buffer.from(await wb.xlsx.writeBuffer());
      type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    const file = await this.cards.publish(`exports/${schoolId}/results-${session.name}-${Date.now()}.${format}`, data, type);
    await this.audit.record({ schoolId, actorId: actor.id, actorRole: actor.role, action: 'results.export', entity: 'session', entityId: session.id, after: { format, rows: rows.length }, ip: actor.ip });
    return { url: file.url, rows: rows.length, session: session.name };
  }
}
