import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RosterService, nameSimilarity } from '../roster/roster.service.js';
import { env } from '../config/env.js';
import { normalizeCode } from '../common/util.js';
import { normalizePkPhone } from '../common/phone.js';
import type { AuthUser } from '../common/decorators.js';
import type { ClaimDto, ResubmitDto } from './claims.dto.js';

type Reviewer = Pick<AuthUser, 'id' | 'role' | 'schoolId'>;

/**
 * Roster first, claim second, approve last.
 * A student (or parent) proves they match a record the school already has. An exact match — school/section
 * code + roll number + date of birth (or a printed one-time code) — links by itself. Only mismatches reach
 * the section's teacher, who can link the account to the right roster student instead of creating a duplicate.
 */
@Injectable()
export class ClaimsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly roster: RosterService,
  ) {}

  onModuleInit() {
    this.auth.emailVerifiedHooks.push((userId) => this.onEmailVerified(userId));
  }

  // ---------- public: find school / section by code ----------

  async lookup(code: string) {
    const c = normalizeCode(code);
    const section = await this.prisma.section.findUnique({ where: { joinCode: c }, include: { schoolClass: { include: { school: true } } } });
    if (section) {
      if (section.joinCodeExpiresAt && section.joinCodeExpiresAt < new Date()) throw new NotFoundException('This class code has expired. Ask your teacher for the new code.');
      const school = section.schoolClass.school;
      return { name: school.name, city: school.city, joinCode: c, section: { id: section.id, name: section.name, classId: section.classId, className: section.schoolClass.name }, classes: [{ id: section.classId, name: section.schoolClass.name, sections: [{ id: section.id, name: section.name }] }] };
    }
    const school = await this.prisma.school.findUnique({
      where: { joinCode: c },
      include: { classes: { orderBy: [{ grade: 'asc' }, { name: 'asc' }], include: { sections: { orderBy: { name: 'asc' } } } } },
    });
    if (!school) throw new NotFoundException('No school or class uses this code. Check it with your teacher.');
    return { name: school.name, city: school.city, joinCode: school.joinCode, section: null, classes: school.classes.map((x) => ({ id: x.id, name: x.name, sections: x.sections.map((s) => ({ id: s.id, name: s.name })) })) };
  }

  private async resolveSection(code: string | undefined, sectionId: string | undefined) {
    if (!code) throw new BadRequestException('Enter your school or class code');
    const info = await this.lookup(code);
    const id = info.section?.id ?? sectionId;
    if (!id) throw new BadRequestException('Choose your class and section');
    const section = await this.prisma.section.findUnique({ where: { id }, include: { schoolClass: true } });
    const school = await this.prisma.school.findFirst({ where: { OR: [{ joinCode: normalizeCode(code) }, { classes: { some: { sections: { some: { joinCode: normalizeCode(code) } } } } }] } });
    if (!section || !school || section.schoolClass.schoolId !== school.id) throw new BadRequestException('Choose your class and section again');
    return { section, schoolId: school.id };
  }

  // ---------- public: sign up + claim ----------

  async claim(dto: ClaimDto) {
    await this.auth.releaseUnverified(dto.email);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw new ConflictException('An account with this email already exists. Log in instead.');
    await this.auth.assertGoodPassword(dto.password, [dto.email, dto.name ?? '']);

    let schoolId: string;
    let sectionId: string;
    let matched: string | null = null;
    let name = dto.name?.trim() ?? '';
    let rollNo = dto.rollNo?.trim() ?? '';
    if (dto.claimCode) {
      // printed one-time code: identifies exactly one roster student
      const s = await this.roster.useClaimCode(dto.claimCode, 'STUDENT', false);
      if (!s) throw new BadRequestException('This code is wrong, used or expired. Ask your teacher for a new card.');
      if (s.userId) throw new ConflictException('This student already has an account. Log in instead.');
      ({ schoolId, sectionId } = s);
      matched = s.id;
      name = name || s.name;
      rollNo = s.rollNo;
    } else {
      if (!rollNo || name.length < 2) throw new BadRequestException('Enter your name and roll number');
      const r = await this.resolveSection(dto.code, dto.sectionId);
      schoolId = r.schoolId;
      sectionId = r.section.id;
    }
    const user = await this.prisma.user.create({
      data: {
        schoolId,
        email: dto.email,
        name,
        phone: dto.phone,
        role: 'STUDENT',
        passwordHash: await this.auth.hash(dto.password),
        claims: {
          create: {
            schoolId,
            sectionId,
            name,
            rollNo,
            dob: dto.dob ? new Date(dto.dob) : null,
            admissionNo: dto.admissionNo || null,
            guardianPhone: normalizePkPhone(dto.guardianPhone),
            matchedStudentId: matched,
          },
        },
      },
    });
    if (dto.claimCode) await this.roster.useClaimCode(dto.claimCode, 'STUDENT', true);
    await this.auth.issueOtp(user.email!, user.name, 'VERIFY_EMAIL');
    return { email: user.email, requiresVerification: true };
  }

  /** After the email is verified: link automatically when the match is exact, else ask the teacher. */
  async onEmailVerified(userId: string) {
    const claim = await this.prisma.claimRequest.findFirst({ where: { userId, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, include: { section: { include: { schoolClass: true } } } });
    if (!claim) return;
    const linked = await this.tryAutoLink(claim.id);
    if (!linked) {
      await this.notifications.notifySectionReviewers(claim.sectionId, {
        title: 'A student wants to join',
        body: `${claim.name} (roll ${claim.rollNo}) asked to join ${claim.section.schoolClass.name} ${claim.section.name}. Link them to the right student or reject.`,
      });
    }
  }

  /** Exact match = same section, same roll, unclaimed, and the date of birth (or the name) agrees. */
  private async tryAutoLink(claimId: string) {
    const c = await this.prisma.claimRequest.findUniqueOrThrow({ where: { id: claimId } });
    let studentId = c.matchedStudentId;
    if (!studentId) {
      const candidates = await this.prisma.studentProfile.findMany({ where: { sectionId: c.sectionId, rollNo: c.rollNo, status: 'ACTIVE', userId: null } });
      const exact = candidates.filter((s) => (s.dob && c.dob ? s.dob.toISOString().slice(0, 10) === c.dob.toISOString().slice(0, 10) : false) || (!s.dob && nameSimilarity(s.name, c.name) >= 0.67));
      if (exact.length !== 1) return false;
      if (exact[0].admissionNo && c.admissionNo && exact[0].admissionNo.toLowerCase() !== c.admissionNo.toLowerCase()) return false;
      studentId = exact[0].id;
    }
    await this.link(claimId, studentId, null);
    return true;
  }

  private async link(claimId: string, studentId: string, reviewerId: string | null) {
    const c = await this.prisma.claimRequest.findUniqueOrThrow({ where: { id: claimId }, include: { user: true } });
    const s = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId }, include: { section: { include: { schoolClass: true } } } });
    if (s.userId && s.userId !== c.userId) throw new ConflictException(`${s.name} is already linked to another account`);
    if (s.schoolId !== c.schoolId) throw new BadRequestException('Student is in another school');
    await this.prisma.$transaction([
      this.prisma.studentProfile.update({ where: { id: studentId }, data: { userId: c.userId } }),
      this.prisma.user.update({ where: { id: c.userId }, data: { schoolId: s.schoolId } }),
      this.prisma.claimRequest.update({ where: { id: claimId }, data: { status: 'APPROVED', matchedStudentId: studentId, reviewedById: reviewerId, reviewedAt: new Date(), rejectReason: null } }),
      this.prisma.claimRequest.updateMany({ where: { userId: c.userId, status: 'PENDING', id: { not: claimId } }, data: { status: 'REJECTED', rejectReason: 'Linked by another request' } }),
    ]);
    if (c.guardianPhone) await this.roster.linkGuardian(this.prisma, s.schoolId, s.id, c.guardianPhone, null);
    await this.audit.record({ schoolId: s.schoolId, actorId: reviewerId, action: reviewerId ? 'claim.approved' : 'claim.auto-linked', entity: 'student', entityId: studentId, after: { userId: c.userId, claimId } });
    await this.notifications.notify([c.userId], {
      type: 'ACCOUNT',
      title: 'You are in!',
      body: `Your account is linked to ${s.section.schoolClass.name} ${s.section.name}, roll ${s.rollNo}. Your checked copies and results will appear here.`,
    });
    if (c.user.email && reviewerId) {
      await this.mail.send({
        to: c.user.email,
        toName: c.user.name,
        subject: 'Your LaalPen account is approved',
        heading: 'You are approved',
        paragraphs: [`Assalam o Alaikum ${c.user.name},`, `You are now linked to ${s.section.schoolClass.name} ${s.section.name} (roll ${s.rollNo}).`, 'Open LaalPen to see your subjects and results.'],
        button: { label: 'Open LaalPen', url: env.appUrl },
      });
    }
  }

  // ---------- student: own request ----------

  async myStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { student: { include: { section: { include: { schoolClass: true } } } } } });
    if (user.student) {
      return { status: 'APPROVED', rollNo: user.student.rollNo, sectionId: user.student.sectionId, className: user.student.section.schoolClass.name, sectionName: user.student.section.name, rejectReason: null, school: null };
    }
    const c = await this.prisma.claimRequest.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, include: { section: { include: { schoolClass: { include: { school: true } } } } } });
    if (!c) throw new ForbiddenException('No join request found');
    return {
      status: c.status,
      rejectReason: c.rejectReason,
      rollNo: c.rollNo,
      sectionId: c.sectionId,
      className: c.section.schoolClass.name,
      sectionName: c.section.name,
      school: await this.lookup(c.section.schoolClass.school.joinCode),
    };
  }

  async resubmit(userId: string, dto: ResubmitDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { student: true } });
    if (user.student) throw new BadRequestException('You are already linked. Ask your school admin to change your class.');
    const section = await this.prisma.section.findUnique({ where: { id: dto.sectionId }, include: { schoolClass: true } });
    if (!section || section.schoolClass.schoolId !== user.schoolId) throw new BadRequestException('Choose your class and section again');
    const recent = await this.prisma.claimRequest.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (recent >= 5) throw new BadRequestException('Too many requests. Ask your teacher to add you.');
    await this.prisma.claimRequest.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'REJECTED', rejectReason: 'Replaced by a new request' } });
    const c = await this.prisma.claimRequest.create({
      data: { schoolId: section.schoolClass.schoolId, sectionId: section.id, userId, name: user.name, rollNo: dto.rollNo, dob: dto.dob ? new Date(dto.dob) : null },
    });
    if (!(await this.tryAutoLink(c.id))) {
      await this.notifications.notifySectionReviewers(section.id, { title: 'A student wants to join', body: `${user.name} (roll ${dto.rollNo}) asked to join ${section.schoolClass.name} ${section.name}.` });
    }
    return this.myStatus(userId);
  }

  /** A logged-in student types the code from a printed claim card. */
  async useCode(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { student: true } });
    if (user.student) throw new BadRequestException('Your account is already linked');
    const s = await this.roster.useClaimCode(code, 'STUDENT', true);
    if (!s) throw new BadRequestException('This code is wrong, used or expired. Ask your teacher for a new card.');
    if (s.userId) throw new ConflictException('This student already has an account');
    const c = await this.prisma.claimRequest.create({ data: { schoolId: s.schoolId, sectionId: s.sectionId, userId, name: user.name, rollNo: s.rollNo, matchedStudentId: s.id } });
    await this.link(c.id, s.id, null);
    return this.myStatus(userId);
  }

  // ---------- teacher / admin: review ----------

  /** Sections this reviewer may approve for: teachers → sections they teach; admins → whole school. */
  private async scope(reviewer: Reviewer) {
    if (reviewer.role === 'ADMIN') return { schoolId: reviewer.schoolId ?? '' };
    const sections = await this.prisma.teachingAssignment.findMany({ where: { teacherId: reviewer.id }, select: { sectionId: true } });
    return { sectionId: { in: [...new Set(sections.map((s) => s.sectionId))] } };
  }

  async list(reviewer: Reviewer) {
    const rows = await this.prisma.claimRequest.findMany({
      where: { status: 'PENDING', user: { emailVerified: true }, ...(await this.scope(reviewer)) },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, email: true, phone: true } }, section: { include: { schoolClass: true } } },
    });
    const sectionIds = [...new Set(rows.map((r) => r.sectionId))];
    const roster = await this.prisma.studentProfile.findMany({ where: { sectionId: { in: sectionIds }, status: 'ACTIVE' }, select: { id: true, name: true, rollNo: true, sectionId: true, userId: true, dob: true } });
    return rows.map((c) => {
      const pool = roster.filter((s) => s.sectionId === c.sectionId);
      const suggestions = pool
        .map((s) => ({ s, score: (s.rollNo === c.rollNo ? 0.6 : 0) + nameSimilarity(s.name, c.name) * 0.4 + (s.dob && c.dob && s.dob.getTime() === c.dob.getTime() ? 0.3 : 0) }))
        .filter((x) => x.score >= 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ s }) => ({ id: s.id, name: s.name, rollNo: s.rollNo, taken: !!s.userId }));
      return {
        id: c.id,
        name: c.name,
        email: c.user.email,
        phone: c.user.phone,
        rollNo: c.rollNo,
        dob: c.dob,
        sectionId: c.sectionId,
        className: c.section.schoolClass.name,
        sectionName: c.section.name,
        guardianPhone: c.guardianPhone,
        requestedAt: c.createdAt,
        suggestions,
        rollTakenBy: pool.find((s) => s.rollNo === c.rollNo)?.name ?? null,
      };
    });
  }

  async count(reviewer: Reviewer) {
    return this.prisma.claimRequest.count({ where: { status: 'PENDING', user: { emailVerified: true }, ...(await this.scope(reviewer)) } });
  }

  private async ownRequest(reviewer: Reviewer, id: string) {
    const c = await this.prisma.claimRequest.findFirst({ where: { id, ...(await this.scope(reviewer)) } });
    if (!c) throw new NotFoundException('Request not found');
    if (c.status !== 'PENDING') throw new BadRequestException('This request was already handled');
    return c;
  }

  /** Link to an existing roster student, or (if they are really new) add them to the roster and link. */
  async approve(reviewer: Reviewer, id: string, studentId?: string) {
    const c = await this.ownRequest(reviewer, id);
    let target = studentId;
    if (target) {
      const s = await this.prisma.studentProfile.findUnique({ where: { id: target } });
      if (!s || s.schoolId !== c.schoolId || s.status !== 'ACTIVE') throw new NotFoundException('Student not found');
    } else {
      const created = await this.roster.createStudent(c.schoolId, { name: c.name, rollNo: c.rollNo, sectionId: c.sectionId, dob: c.dob, guardianPhone: c.guardianPhone }, reviewer as AuthUser);
      target = created.id;
    }
    await this.link(c.id, target, reviewer.id);
    return { ok: true, studentId: target };
  }

  async reject(reviewer: Reviewer, id: string, reason?: string) {
    const c = await this.ownRequest(reviewer, id);
    const why = reason?.trim() || 'Your details did not match our records.';
    await this.prisma.claimRequest.update({ where: { id: c.id }, data: { status: 'REJECTED', reviewedById: reviewer.id, reviewedAt: new Date(), rejectReason: why } });
    await this.audit.record({ schoolId: c.schoolId, actorId: reviewer.id, actorRole: reviewer.role, action: 'claim.rejected', entity: 'claim', entityId: c.id, reason: why });
    await this.notifications.notify([c.userId], {
      type: 'ACCOUNT',
      title: 'Join request not approved',
      body: `${why} Check your class, section, roll number and date of birth and send the request again.`,
    });
    return { ok: true };
  }
}
