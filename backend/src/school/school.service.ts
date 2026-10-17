import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AuditService } from '../audit/audit.service.js';
import { env } from '../config/env.js';
import type { AuthUser } from '../common/decorators.js';
import type { SchoolProfileDto, TeacherProfileDto } from './school.dto.js';

const COLORS = ['#B3261E', '#1E6FB3', '#2E7D32', '#8E24AA', '#EF6C00', '#00897B', '#5D4037', '#C2185B', '#3949AB', '#7CB342'];
type Pair = { sectionId: string; subject: string };
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const gradeOf = (name: string) => Number(name.match(/\d+/)?.[0] ?? 0) || 0;

/** School profile (principal), teacher profile (teacher) and the principal's approval of teachers. */
@Injectable()
export class SchoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private sid(u: AuthUser) {
    if (!u.schoolId) throw new ForbiddenException('No school linked to this account');
    return u.schoolId;
  }

  private async sections(schoolId: string) {
    const rows = await this.prisma.section.findMany({ where: { schoolClass: { schoolId } }, include: { schoolClass: true }, orderBy: [{ schoolClass: { grade: 'asc' } }, { schoolClass: { name: 'asc' } }, { name: 'asc' }] });
    return rows.map((s) => ({ id: s.id, classId: s.classId, className: s.schoolClass.name, name: s.name, label: `${s.schoolClass.name.replace(/^Class\s*/i, '')}-${s.name}` }));
  }

  // ---------- principal: school profile ----------

  async getSchoolProfile(u: AuthUser) {
    const id = this.sid(u);
    const s = await this.prisma.school.findUniqueOrThrow({
      where: { id },
      include: { classes: { orderBy: [{ grade: 'asc' }, { name: 'asc' }], include: { sections: { orderBy: { name: 'asc' } } } }, subjects: { orderBy: { name: 'asc' } } },
    });
    return {
      id: s.id, name: s.name, city: s.city, address: s.address, phone: s.phone, board: s.board, logoUrl: s.logoUrl, joinCode: s.joinCode,
      profileComplete: !!s.profileCompletedAt,
      classes: s.classes.map((c) => ({ id: c.id, name: c.name, grade: c.grade, sections: c.sections.map((x) => x.name) })),
      subjects: s.subjects.map((x) => x.name),
    };
  }

  /** Saves the profile; classes, sections and subjects are added (never deleted here, so no test is lost). */
  async saveSchoolProfile(u: AuthUser, dto: SchoolProfileDto) {
    const id = this.sid(u);
    const before = await this.prisma.school.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction(async (tx) => {
      await tx.school.update({
        where: { id },
        data: { name: dto.name, address: dto.address, city: dto.city, phone: dto.phone, board: dto.board || before.board, logoUrl: dto.logoUrl || null, profileCompletedAt: before.profileCompletedAt ?? new Date() },
      });
      for (const c of dto.classes) {
        const name = clean(c.name);
        const cls = await tx.schoolClass.upsert({ where: { schoolId_name: { schoolId: id, name } }, update: {}, create: { schoolId: id, name, grade: c.grade ?? gradeOf(name) } });
        for (const raw of [...new Set(c.sections.map((x) => clean(x).toUpperCase()).filter(Boolean))]) {
          await tx.section.upsert({ where: { classId_name: { classId: cls.id, name: raw } }, update: {}, create: { classId: cls.id, name: raw } });
        }
      }
      const existing = await tx.subject.count({ where: { schoolId: id } });
      let i = existing;
      for (const raw of [...new Set((dto.subjects ?? []).map(clean).filter(Boolean))]) {
        const found = await tx.subject.findFirst({ where: { schoolId: id, name: { equals: raw, mode: 'insensitive' } } });
        if (!found) await tx.subject.create({ data: { schoolId: id, name: raw, color: COLORS[i++ % COLORS.length] } });
      }
    });
    await this.audit.record({ schoolId: id, actorId: u.id, actorRole: u.role, action: before.profileCompletedAt ? 'school.profile-updated' : 'school.profile-completed', entity: 'school', entityId: id, ip: u.ip });
    return this.getSchoolProfile(u);
  }

  // ---------- teacher: own profile ----------

  async getTeacherProfile(u: AuthUser) {
    const schoolId = this.sid(u);
    const [user, p, school, sections, subjects] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { name: true, email: true, phone: true } }),
      this.prisma.teacherProfile.findUnique({ where: { userId: u.id } }),
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true } }),
      this.sections(schoolId),
      this.prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' }, select: { name: true } }),
    ]);
    return {
      name: user.name,
      email: user.email,
      phone: p?.phone ?? user.phone,
      qualification: p?.qualification ?? '',
      subjects: p?.subjects ?? [],
      sections: ((p?.sections as Pair[] | null) ?? []).map((x) => ({ ...x, label: sections.find((s) => s.id === x.sectionId)?.label ?? '?' })),
      status: p?.status ?? 'PROFILE_INCOMPLETE',
      rejectReason: p?.rejectReason ?? null,
      submittedAt: p?.submittedAt ?? null,
      school: school.name,
      options: { sections, subjects: subjects.map((s) => s.name) },
    };
  }

  /** Sends the profile to the principal (status PENDING). An approved teacher asks the principal for changes instead. */
  async submitTeacherProfile(u: AuthUser, dto: TeacherProfileDto) {
    const schoolId = this.sid(u);
    const current = await this.prisma.teacherProfile.findUnique({ where: { userId: u.id } });
    if (current?.status === 'APPROVED') throw new BadRequestException('Your profile is already approved. Ask your principal to change your classes.');
    const valid = new Set((await this.sections(schoolId)).map((s) => s.id));
    const pairs: Pair[] = [];
    const seen = new Set<string>();
    for (const p of dto.sections) {
      if (!valid.has(p.sectionId)) throw new BadRequestException('Choose classes from your school list');
      const key = `${p.sectionId}|${clean(p.subject).toLowerCase()}`;
      if (!seen.has(key)) pairs.push({ sectionId: p.sectionId, subject: clean(p.subject) });
      seen.add(key);
    }
    const subjects = [...new Set([...dto.subjects.map(clean), ...pairs.map((p) => p.subject)].filter(Boolean))];
    const data = { schoolId, phone: dto.phone, qualification: dto.qualification, subjects, sections: pairs, status: 'PENDING' as const, rejectReason: null, submittedAt: new Date() };
    await this.prisma.teacherProfile.upsert({ where: { userId: u.id }, update: data, create: { userId: u.id, ...data } });
    await this.prisma.user.update({ where: { id: u.id }, data: { name: dto.name, phone: dto.phone } });
    await this.audit.record({ schoolId, actorId: u.id, actorRole: u.role, action: 'teacher.profile-submitted', entity: 'user', entityId: u.id, ip: u.ip });
    const principals = await this.prisma.user.findMany({ where: { schoolId, role: 'PRINCIPAL', isActive: true }, select: { id: true, email: true, name: true } });
    await this.notifications.notify(principals.map((p) => p.id), {
      type: 'ACCOUNT',
      title: 'Teacher waiting for approval',
      body: `${dto.name} sent their profile (${subjects.join(', ')}). Check it and approve or reject.`,
      data: { teacherId: u.id, teacherApproval: 'true' },
    });
    for (const p of principals) {
      if (!p.email) continue;
      await this.mail
        .send({
          to: p.email,
          toName: p.name,
          subject: `${dto.name} is waiting for your approval on LaalPen`,
          heading: 'A teacher needs your approval',
          paragraphs: [`Assalam o Alaikum ${p.name},`, `${dto.name} completed their teacher profile: ${dto.qualification}; teaches ${subjects.join(', ')}.`, 'They cannot see any student until you approve them. Open Teachers in LaalPen to approve or reject.'],
          button: { label: 'Review teacher', url: `${env.appUrl.replace(/\/+$/, '')}/admin/teachers` },
        })
        .catch(() => undefined);
    }
    return this.getTeacherProfile(u);
  }

  // ---------- principal: approve / reject teachers ----------

  private async ownTeacher(u: AuthUser, id: string) {
    const t = await this.prisma.user.findUnique({ where: { id }, include: { teacherProfile: true } });
    if (!t || t.role !== 'TEACHER' || t.schoolId !== this.sid(u)) throw new NotFoundException('Teacher not found');
    return t;
  }

  /** Approves: the classes the teacher asked for become their teaching assignments (subjects are added if new). */
  async approveTeacher(u: AuthUser, id: string) {
    const schoolId = this.sid(u);
    const t = await this.ownTeacher(u, id);
    const p = t.teacherProfile;
    if (!p || p.status === 'PROFILE_INCOMPLETE') throw new BadRequestException('This teacher has not completed their profile yet');
    if (p.status === 'APPROVED') throw new BadRequestException('This teacher is already approved');
    const created: string[] = [];
    const skipped: string[] = [];
    const labels = new Map((await this.sections(schoolId)).map((s) => [s.id, s.label]));
    for (const pair of (p.sections as Pair[]) ?? []) {
      if (!labels.has(pair.sectionId)) continue;
      let subject = await this.prisma.subject.findFirst({ where: { schoolId, name: { equals: pair.subject, mode: 'insensitive' } } });
      if (!subject) subject = await this.prisma.subject.create({ data: { schoolId, name: pair.subject, color: COLORS[(await this.prisma.subject.count({ where: { schoolId } })) % COLORS.length] } });
      const label = `${labels.get(pair.sectionId)} ${subject.name}`;
      const existing = await this.prisma.teachingAssignment.findUnique({ where: { sectionId_subjectId: { sectionId: pair.sectionId, subjectId: subject.id } }, include: { teacher: { select: { name: true } } } });
      if (existing && existing.teacherId !== id) skipped.push(`${label} (already taught by ${existing.teacher.name})`);
      else if (!existing) {
        await this.prisma.teachingAssignment.create({ data: { teacherId: id, sectionId: pair.sectionId, subjectId: subject.id } });
        created.push(label);
      }
    }
    await this.prisma.teacherProfile.update({ where: { userId: id }, data: { status: 'APPROVED', rejectReason: null, reviewedAt: new Date(), reviewedById: u.id } });
    await this.audit.record({ schoolId, actorId: u.id, actorRole: u.role, action: 'teacher.approved', entity: 'user', entityId: id, after: { created, skipped }, ip: u.ip });
    await this.notifications.notify([id], { type: 'ACCOUNT', title: 'Your profile is approved', body: created.length ? `You can now check copies for ${created.join(', ')}.` : 'Your principal approved you. Your classes will appear here.' });
    if (t.email) {
      await this.mail
        .send({
          to: t.email,
          toName: t.name,
          subject: 'Your LaalPen teacher profile is approved',
          heading: 'You are approved',
          paragraphs: [`Assalam o Alaikum ${t.name},`, 'Your principal approved your teacher profile.', created.length ? `Your classes: ${created.join(', ')}.` : 'Your principal will assign your classes.'],
          button: { label: 'Open LaalPen', url: env.appUrl },
        })
        .catch(() => undefined);
    }
    return { ok: true, created, skipped };
  }

  async rejectTeacher(u: AuthUser, id: string, reason: string) {
    const schoolId = this.sid(u);
    const t = await this.ownTeacher(u, id);
    if (!t.teacherProfile || t.teacherProfile.status !== 'PENDING') throw new BadRequestException('Only a profile that is waiting can be rejected');
    await this.prisma.teacherProfile.update({ where: { userId: id }, data: { status: 'REJECTED', rejectReason: reason, reviewedAt: new Date(), reviewedById: u.id } });
    await this.audit.record({ schoolId, actorId: u.id, actorRole: u.role, action: 'teacher.rejected', entity: 'user', entityId: id, reason, ip: u.ip });
    await this.notifications.notify([id], { type: 'ACCOUNT', title: 'Your profile needs changes', body: `Your principal said: ${reason}` });
    if (t.email) {
      await this.mail
        .send({
          to: t.email,
          toName: t.name,
          subject: 'Your LaalPen teacher profile needs changes',
          heading: 'Please fix your profile',
          paragraphs: [`Assalam o Alaikum ${t.name},`, `Your principal did not approve your profile yet. Reason: ${reason}`, 'Open LaalPen, fix your profile and send it again.'],
          button: { label: 'Open LaalPen', url: env.appUrl },
        })
        .catch(() => undefined);
    }
    return { ok: true };
  }

  /** Teachers waiting for approval, with what they asked to teach. */
  async pendingTeachers(u: AuthUser) {
    const schoolId = this.sid(u);
    const labels = new Map((await this.sections(schoolId)).map((s) => [s.id, s.label]));
    const rows = await this.prisma.teacherProfile.findMany({ where: { schoolId, status: 'PENDING' }, orderBy: { submittedAt: 'asc' }, include: { user: { select: { id: true, name: true, email: true } } } });
    return rows.map((p) => ({
      id: p.user.id, name: p.user.name, email: p.user.email, phone: p.phone, qualification: p.qualification, subjects: p.subjects, submittedAt: p.submittedAt,
      sections: ((p.sections as Pair[]) ?? []).map((x) => ({ ...x, label: labels.get(x.sectionId) ?? '?' })),
    }));
  }
}
