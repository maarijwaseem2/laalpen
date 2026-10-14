import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { env } from '../config/env.js';
import { tempPassword } from '../common/util.js';
import { AuditService } from '../audit/audit.service.js';
import { RosterService } from '../roster/roster.service.js';
import type { AuthUser } from '../common/decorators.js';
import type {
  AssignmentDto, CreateClassDto, CreateStudentDto, CreateTeacherDto, SubjectDto, UpdateClassDto,
  UpdateStudentDto, UpdateSubjectDto, UpdateTeacherDto,
} from './admin.dto.js';

const SUBJECT_COLORS = ['#B3261E', '#1E6FB3', '#2E7D32', '#8E24AA', '#EF6C00', '#00897B', '#5D4037', '#C2185B', '#3949AB', '#7CB342'];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly roster: RosterService,
    private readonly audit: AuditService,
  ) {}

  private school(schoolId: string | null): string {
    if (!schoolId) throw new ForbiddenException('No school linked to this account');
    return schoolId;
  }

  // ---------- dashboard ----------

  async dashboard(schoolIdRaw: string | null) {
    const schoolId = this.school(schoolIdRaw);
    const inSchool = { assignment: { subject: { schoolId } } };
    const [school, classes, sections, teachers, students, subjects, tests, approved, pendingReview, recentTests, classRows] = await Promise.all([
      this.prisma.school.findUnique({ where: { id: schoolId } }),
      this.prisma.schoolClass.count({ where: { schoolId } }),
      this.prisma.section.count({ where: { schoolClass: { schoolId } } }),
      this.prisma.user.count({ where: { schoolId, role: 'TEACHER' } }),
      this.prisma.studentProfile.count({ where: { schoolId, status: 'ACTIVE' } }),
      this.prisma.subject.count({ where: { schoolId } }),
      this.prisma.test.count({ where: inSchool }),
      this.prisma.submission.count({ where: { status: 'APPROVED', test: inSchool } }),
      this.prisma.submission.count({ where: { status: { in: ['CHECKED', 'NEEDS_REVIEW'] }, test: inSchool } }),
      this.prisma.test.findMany({
        where: inSchool,
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: {
          assignment: { include: { subject: true, teacher: { select: { name: true } }, section: { include: { schoolClass: true } } } },
          _count: { select: { submissions: true } },
        },
      }),
      this.prisma.schoolClass.findMany({
        where: { schoolId },
        orderBy: [{ grade: 'asc' }, { name: 'asc' }],
        include: { sections: { include: { _count: { select: { students: { where: { status: 'ACTIVE' } } } } } } },
      }),
    ]);
    const joinRequests = await this.prisma.claimRequest.count({ where: { schoolId, status: 'PENDING', user: { emailVerified: true } } });
    return {
      school,
      stats: { classes, sections, teachers, students, subjects, tests, copiesChecked: approved, pendingReview, joinRequests },
      recentTests: recentTests.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        testDate: t.testDate,
        subject: t.assignment.subject.name,
        subjectColor: t.assignment.subject.color,
        className: t.assignment.section.schoolClass.name,
        sectionName: t.assignment.section.name,
        teacher: t.assignment.teacher.name,
        submissions: t._count.submissions,
      })),
      classes: classRows.map((c) => ({
        id: c.id,
        name: c.name,
        students: c.sections.reduce((a, s) => a + s._count.students, 0),
        sections: c.sections.length,
      })),
    };
  }

  // ---------- AI cost report ----------

  /** What AI checking cost this school: totals, cost per checked copy, per model and per test. */
  async aiUsage(schoolIdRaw: string | null, days = 30) {
    const schoolId = this.school(schoolIdRaw);
    const since = new Date(Date.now() - Math.max(1, Math.min(days, 366)) * 86_400_000);
    const where = { schoolId, createdAt: { gte: since } };
    const [totals, byPurpose, byModel, byTest, copies] = await Promise.all([
      this.prisma.aiUsage.aggregate({ where, _sum: { costUsd: true, inputTokens: true, cachedTokens: true, outputTokens: true, calls: true } }),
      this.prisma.aiUsage.groupBy({ by: ['purpose'], where, _sum: { costUsd: true, calls: true } }),
      this.prisma.aiUsage.groupBy({ by: ['model'], where, _sum: { costUsd: true, calls: true, outputTokens: true } }),
      this.prisma.aiUsage.groupBy({ by: ['testId'], where: { ...where, testId: { not: null } }, _sum: { costUsd: true }, _count: { submissionId: true }, orderBy: { _sum: { costUsd: 'desc' } }, take: 10 }),
      this.prisma.aiUsage.groupBy({ by: ['submissionId'], where: { ...where, purpose: 'check', submissionId: { not: null } } }),
    ]);
    const tests = await this.prisma.test.findMany({ where: { id: { in: byTest.map((t) => t.testId!) } }, select: { id: true, title: true, assignment: { select: { subject: { select: { name: true } }, section: { select: { name: true, schoolClass: { select: { name: true } } } } } } } });
    const cost = totals._sum.costUsd ?? 0;
    const input = totals._sum.inputTokens ?? 0;
    return {
      days,
      costUsd: Math.round(cost * 10000) / 10000,
      calls: totals._sum.calls ?? 0,
      copiesChecked: copies.length,
      costPerCopyUsd: copies.length ? Math.round((cost / copies.length) * 100000) / 100000 : 0,
      cachedShare: input ? Math.round(((totals._sum.cachedTokens ?? 0) / input) * 1000) / 1000 : 0,
      outputTokens: totals._sum.outputTokens ?? 0,
      byPurpose: byPurpose.map((p) => ({ purpose: p.purpose, costUsd: p._sum.costUsd ?? 0, calls: p._sum.calls ?? 0 })),
      byModel: byModel.map((m) => ({ model: m.model, costUsd: m._sum.costUsd ?? 0, calls: m._sum.calls ?? 0, outputTokens: m._sum.outputTokens ?? 0 })),
      topTests: byTest.map((t) => {
        const info = tests.find((x) => x.id === t.testId);
        return { testId: t.testId, title: info?.title ?? '—', subject: info?.assignment.subject.name, className: info ? `${info.assignment.section.schoolClass.name} ${info.assignment.section.name}` : null, costUsd: t._sum.costUsd ?? 0, calls: t._count.submissionId };
      }),
    };
  }

  // ---------- classes & sections ----------

  async listClasses(schoolIdRaw: string | null) {
    const schoolId = this.school(schoolIdRaw);
    const rows = await this.prisma.schoolClass.findMany({
      where: { schoolId },
      orderBy: [{ grade: 'asc' }, { name: 'asc' }],
      include: {
        sections: {
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { students: { where: { status: 'ACTIVE' } } } },
            teaching: { include: { subject: true, teacher: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      grade: c.grade,
      sections: c.sections.map((s) => ({
        id: s.id,
        name: s.name,
        students: s._count.students,
        subjects: s.teaching.map((t) => ({ assignmentId: t.id, subjectId: t.subjectId, subject: t.subject.name, color: t.subject.color, teacherId: t.teacher.id, teacher: t.teacher.name })),
      })),
    }));
  }

  async createClass(schoolIdRaw: string | null, dto: CreateClassDto) {
    const schoolId = this.school(schoolIdRaw);
    const dup = await this.prisma.schoolClass.findUnique({ where: { schoolId_name: { schoolId, name: dto.name } } });
    if (dup) throw new ConflictException(`${dto.name} already exists`);
    const names = [...new Set((dto.sections?.length ? dto.sections : ['A']).map((s) => s.trim()).filter(Boolean))];
    return this.prisma.schoolClass.create({
      data: { schoolId, name: dto.name, grade: dto.grade, sections: { create: names.map((name) => ({ name })) } },
      include: { sections: true },
    });
  }

  async updateClass(schoolId: string | null, id: string, dto: UpdateClassDto) {
    await this.ownClass(schoolId, id);
    return this.prisma.schoolClass.update({ where: { id }, data: dto });
  }

  async deleteClass(schoolId: string | null, id: string) {
    await this.ownClass(schoolId, id);
    const students = await this.prisma.studentProfile.count({ where: { section: { classId: id }, status: 'ACTIVE' } });
    if (students) throw new BadRequestException('Move the students of this class first (or mark them as left)');
    const tests = await this.prisma.test.count({ where: { assignment: { section: { classId: id } } } });
    if (tests) throw new BadRequestException('This class has tests and marks, so it cannot be deleted');
    await this.prisma.schoolClass.delete({ where: { id } });
    return { ok: true };
  }

  async addSection(schoolId: string | null, classId: string, name: string) {
    await this.ownClass(schoolId, classId);
    const dup = await this.prisma.section.findUnique({ where: { classId_name: { classId, name } } });
    if (dup) throw new ConflictException(`Section ${name} already exists`);
    return this.prisma.section.create({ data: { classId, name } });
  }

  async renameSection(schoolId: string | null, id: string, name: string) {
    await this.ownSection(schoolId, id);
    return this.prisma.section.update({ where: { id }, data: { name } });
  }

  async deleteSection(schoolId: string | null, id: string) {
    await this.ownSection(schoolId, id);
    const students = await this.prisma.studentProfile.count({ where: { sectionId: id, status: 'ACTIVE' } });
    if (students) throw new BadRequestException('Move the students of this section first (or mark them as left)');
    const tests = await this.prisma.test.count({ where: { assignment: { sectionId: id } } });
    if (tests) throw new BadRequestException('This section has tests and marks, so it cannot be deleted');
    await this.prisma.section.delete({ where: { id } });
    return { ok: true };
  }

  async sectionDetail(schoolId: string | null, id: string) {
    await this.ownSection(schoolId, id);
    const s = await this.prisma.section.findUniqueOrThrow({
      where: { id },
      include: {
        schoolClass: true,
        students: { where: { status: 'ACTIVE' }, orderBy: { rollNo: 'asc' }, include: { user: { select: { id: true, name: true, email: true, phone: true, isActive: true } }, _count: { select: { guardians: true } } } },
        teaching: { include: { subject: true, teacher: { select: { id: true, name: true, email: true } } } },
      },
    });
    return {
      id: s.id,
      name: s.name,
      className: s.schoolClass.name,
      classId: s.classId,
      joinCode: s.joinCode,
      joinCodeExpiresAt: s.joinCodeExpiresAt,
      students: s.students.map((p) => this.studentRow({ ...p, section: s })),
      subjects: s.teaching.map((t) => ({ assignmentId: t.id, subjectId: t.subjectId, subject: t.subject.name, color: t.subject.color, teacher: t.teacher })),
    };
  }

  // ---------- subjects ----------

  async listSubjects(schoolIdRaw: string | null) {
    const schoolId = this.school(schoolIdRaw);
    const rows = await this.prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' }, include: { _count: { select: { teaching: true } } } });
    return rows.map((s) => ({ id: s.id, name: s.name, code: s.code, color: s.color, sections: s._count.teaching }));
  }

  async createSubject(schoolIdRaw: string | null, dto: SubjectDto) {
    const schoolId = this.school(schoolIdRaw);
    const dup = await this.prisma.subject.findUnique({ where: { schoolId_name: { schoolId, name: dto.name } } });
    if (dup) throw new ConflictException(`${dto.name} already exists`);
    const count = await this.prisma.subject.count({ where: { schoolId } });
    return this.prisma.subject.create({ data: { schoolId, ...dto, color: dto.color ?? SUBJECT_COLORS[count % SUBJECT_COLORS.length] } });
  }

  async updateSubject(schoolId: string | null, id: string, dto: UpdateSubjectDto) {
    await this.ownSubject(schoolId, id);
    return this.prisma.subject.update({ where: { id }, data: dto });
  }

  async deleteSubject(schoolId: string | null, id: string) {
    await this.ownSubject(schoolId, id);
    const tests = await this.prisma.test.count({ where: { assignment: { subjectId: id } } });
    if (tests) throw new BadRequestException('This subject has tests and cannot be deleted');
    await this.prisma.subject.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- teachers ----------

  async listTeachers(schoolIdRaw: string | null, search?: string) {
    const schoolId = this.school(schoolIdRaw);
    const rows = await this.prisma.user.findMany({
      where: {
        schoolId,
        role: 'TEACHER',
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { name: 'asc' },
      include: { teaching: { include: { subject: true, section: { include: { schoolClass: true } } } } },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      phone: t.phone,
      isActive: t.isActive,
      assignments: t.teaching.map((a) => ({
        id: a.id,
        subject: a.subject.name,
        color: a.subject.color,
        sectionId: a.sectionId,
        className: a.section.schoolClass.name,
        sectionName: a.section.name,
      })),
    }));
  }

  async createTeacher(schoolIdRaw: string | null, dto: CreateTeacherDto) {
    const schoolId = this.school(schoolIdRaw);
    const user = await this.createUser(schoolId, { name: dto.name, email: dto.email, phone: dto.phone, password: dto.password, role: 'TEACHER' });
    return user;
  }

  async updateTeacher(schoolId: string | null, id: string, dto: UpdateTeacherDto) {
    await this.ownUser(schoolId, id, 'TEACHER');
    await this.prisma.user.update({ where: { id }, data: dto });
    if (dto.isActive === false) await this.auth.revokeAll(id, 'disabled-by-admin');
    return { ok: true };
  }

  async deleteTeacher(schoolId: string | null, id: string) {
    await this.ownUser(schoolId, id, 'TEACHER');
    const tests = await this.prisma.test.count({ where: { assignment: { teacherId: id } } });
    if (tests) throw new BadRequestException('This teacher has tests. Disable the account instead of deleting it.');
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }

  async assign(schoolId: string | null, dto: AssignmentDto) {
    await this.ownUser(schoolId, dto.teacherId, 'TEACHER');
    await this.ownSection(schoolId, dto.sectionId);
    await this.ownSubject(schoolId, dto.subjectId);
    const existing = await this.prisma.teachingAssignment.findUnique({ where: { sectionId_subjectId: { sectionId: dto.sectionId, subjectId: dto.subjectId } } });
    let row;
    if (existing) {
      // One teacher per subject per section: re-assigning hands the subject (and its tests) to the new teacher.
      row = await this.prisma.teachingAssignment.update({ where: { id: existing.id }, data: { teacherId: dto.teacherId } });
    } else {
      row = await this.prisma.teachingAssignment.create({ data: dto });
    }
    const full = await this.prisma.teachingAssignment.findUniqueOrThrow({
      where: { id: row.id },
      include: { subject: true, section: { include: { schoolClass: true } } },
    });
    await this.notifications.notify([dto.teacherId], {
      type: 'ACCOUNT',
      title: 'New class assigned',
      body: `You now teach ${full.subject.name} to ${full.section.schoolClass.name} ${full.section.name}.`,
      data: { assignmentId: row.id },
    });
    return full;
  }

  async unassign(schoolId: string | null, id: string) {
    const a = await this.prisma.teachingAssignment.findUnique({ where: { id }, include: { subject: true } });
    if (!a || a.subject.schoolId !== schoolId) throw new NotFoundException('Assignment not found');
    const tests = await this.prisma.test.count({ where: { assignmentId: id } });
    if (tests) throw new BadRequestException('This subject already has tests in this section. Assign another teacher instead.');
    await this.prisma.teachingAssignment.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- students (the roster) ----------

  async listStudents(schoolIdRaw: string | null, sectionId?: string, search?: string, status: 'ACTIVE' | 'LEFT' | 'GRADUATED' | 'ALL' | 'APPROVED' = 'ACTIVE', cursor?: string, take = 300) {
    const schoolId = this.school(schoolIdRaw);
    const st = status === 'APPROVED' ? 'ACTIVE' : status;
    const rows = await this.prisma.studentProfile.findMany({
      where: {
        schoolId,
        ...(st !== 'ALL' ? { status: st } : {}),
        ...(sectionId ? { sectionId } : {}),
        ...(search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { rollNo: { contains: search } }, { admissionNo: { contains: search, mode: 'insensitive' } }, { user: { email: { contains: search, mode: 'insensitive' } } }, { guardianPhone: { contains: search.replace(/^0/, '') } }] }
          : {}),
      },
      orderBy: [{ section: { schoolClass: { grade: 'asc' } } }, { sectionId: 'asc' }, { rollNo: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(take, 1), 500),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { user: { select: { id: true, name: true, email: true, phone: true, isActive: true } }, section: { include: { schoolClass: true } }, _count: { select: { guardians: true } } },
    });
    return rows.map((p) => this.studentRow(p));
  }

  /** Adds a roster student. With an email, an app account is created too and the password is emailed. */
  async createStudent(schoolIdRaw: string | null, dto: CreateStudentDto, actor?: AuthUser) {
    const schoolId = this.school(schoolIdRaw);
    if (dto.email && (await this.prisma.user.findUnique({ where: { email: dto.email } }))) throw new ConflictException('An account with this email already exists');
    if (dto.password) await this.auth.assertGoodPassword(dto.password, [dto.email ?? '', dto.name]);
    const p = await this.roster.createStudent(schoolId, { ...dto, dob: dto.dob ? new Date(dto.dob) : null }, actor);
    let userId: string | null = null;
    if (dto.email) {
      const user = await this.createUser(schoolId, { name: dto.name, email: dto.email, phone: dto.phone, password: dto.password, role: 'STUDENT' });
      await this.prisma.studentProfile.update({ where: { id: p.id }, data: { userId: user.id } });
      userId = user.id;
    }
    await this.audit.record({ schoolId, actorId: actor?.id, actorRole: actor?.role, action: 'student.create', entity: 'student', entityId: p.id, after: { name: p.name, rollNo: p.rollNo, sectionId: p.sectionId } });
    return { id: p.id, profileId: p.id, userId, name: p.name, rollNo: p.rollNo, email: dto.email ?? null };
  }

  async updateStudent(schoolId: string | null, id: string, dto: UpdateStudentDto, actor: AuthUser) {
    const p = await this.ownStudent(schoolId, id);
    const { phone, isActive, dob, ...rest } = dto;
    await this.roster.updateStudent(p.schoolId, p.id, { ...rest, ...(dob !== undefined ? { dob: dob ? new Date(dob) : null } : {}) }, actor);
    if (p.userId && (dto.name || phone !== undefined || isActive !== undefined)) {
      await this.prisma.user.update({ where: { id: p.userId }, data: { ...(dto.name ? { name: dto.name } : {}), ...(phone !== undefined ? { phone } : {}), ...(isActive !== undefined ? { isActive } : {}) } });
      if (isActive === false) await this.auth.revokeAll(p.userId, 'disabled-by-admin');
    }
    return { ok: true };
  }

  /** Only students with no marks can be deleted; everyone else is "marked as left" so results are kept. */
  async deleteStudent(schoolId: string | null, id: string, actor: AuthUser) {
    const p = await this.ownStudent(schoolId, id);
    const subs = await this.prisma.submission.count({ where: { studentId: p.id } });
    if (subs) throw new BadRequestException('This student has checked copies. Mark them as left instead, so their results are kept.');
    await this.prisma.studentProfile.delete({ where: { id: p.id } });
    if (p.userId) await this.prisma.user.delete({ where: { id: p.userId } }).catch(() => undefined);
    await this.audit.record({ schoolId: p.schoolId, actorId: actor.id, actorRole: actor.role, action: 'student.delete', entity: 'student', entityId: p.id, before: { name: p.name, rollNo: p.rollNo } });
    return { ok: true };
  }

  private async ownStudent(schoolId: string | null, id: string) {
    // accepts the roster id or (older apps) the student's account id
    const p = (await this.prisma.studentProfile.findUnique({ where: { id } })) ?? (await this.prisma.studentProfile.findUnique({ where: { userId: id } }));
    if (!p || p.schoolId !== schoolId) throw new NotFoundException('Student not found');
    return p;
  }

  // ---------- helpers ----------

  private async createUser(
    schoolId: string,
    input: { name: string; email: string; phone?: string; password?: string; role: 'TEACHER' | 'STUDENT' },
  ) {
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException('An account with this email already exists');
    if (input.password) await this.auth.assertGoodPassword(input.password, [input.email, input.name]);
    const password = input.password || tempPassword();
    const user = await this.prisma.user.create({
      data: {
        schoolId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: input.role,
        emailVerified: true,
        passwordHash: await this.auth.hash(password),
      },
      select: { id: true, name: true, email: true, role: true },
    });
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    await this.mail.send({
      to: user.email!,
      toName: user.name,
      subject: `Your LaalPen account at ${school?.name ?? 'your school'}`,
      heading: 'Welcome to LaalPen',
      paragraphs: [
        `Assalam o Alaikum ${user.name},`,
        `${school?.name ?? 'Your school'} has created a ${input.role === 'TEACHER' ? 'teacher' : 'student'} account for you.`,
        `Email: ${user.email}`,
        `Temporary password: ${password}`,
        'You can also sign in with Google using this email. Please change your password after your first login.',
      ],
      button: { label: 'Open LaalPen', url: env.appUrl },
    });
    await this.notifications.notify([user.id], { type: 'ACCOUNT', title: 'Welcome to LaalPen', body: `Your ${input.role.toLowerCase()} account is ready.` });
    return user;
  }

  private studentRow(p: any) {
    return {
      id: p.id,
      profileId: p.id,
      userId: p.user?.id ?? null,
      hasAccount: !!p.user,
      name: p.name,
      email: p.user?.email ?? null,
      phone: p.user?.phone ?? null,
      isActive: p.user?.isActive ?? true,
      rollNo: p.rollNo,
      admissionNo: p.admissionNo ?? null,
      fatherName: p.fatherName ?? null,
      dob: p.dob ?? null,
      bFormLast4: p.bFormLast4 ?? null,
      sectionId: p.sectionId,
      className: p.section?.schoolClass?.name,
      sectionName: p.section?.name,
      guardianName: p.guardianName,
      guardianEmail: p.guardianEmail,
      guardianPhone: p.guardianPhone,
      parentsLinked: p._count?.guardians ?? 0,
      status: p.status,
    };
  }

  private async ownClass(schoolId: string | null, id: string) {
    const c = await this.prisma.schoolClass.findUnique({ where: { id } });
    if (!c || c.schoolId !== schoolId) throw new NotFoundException('Class not found');
    return c;
  }
  private async ownSection(schoolId: string | null, id: string) {
    const s = await this.prisma.section.findUnique({ where: { id }, include: { schoolClass: true } });
    if (!s || s.schoolClass.schoolId !== schoolId) throw new NotFoundException('Section not found');
    return s;
  }
  private async ownSubject(schoolId: string | null, id: string) {
    const s = await this.prisma.subject.findUnique({ where: { id } });
    if (!s || s.schoolId !== schoolId) throw new NotFoundException('Subject not found');
    return s;
  }
  private async ownUser(schoolId: string | null, id: string, role: 'TEACHER' | 'STUDENT') {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u || u.schoolId !== schoolId || u.role !== role) throw new NotFoundException(`${role === 'TEACHER' ? 'Teacher' : 'Student'} not found`);
    return u;
  }
}
