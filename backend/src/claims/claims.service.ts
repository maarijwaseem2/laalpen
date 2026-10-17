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
    const c = await this.prisma.claimRequest.findUniqueOrThrow({ where: { id: claimId }, include: { user: { select: { role: true } } } });
    const family = c.user.role === 'PARENT';
    let studentId = c.matchedStudentId;
    if (!studentId) {
      // a parent links to a child who may already have their own student account; a student claims an unclaimed record
      const candidates = await this.prisma.studentProfile.findMany({ where: { sectionId: c.sectionId, rollNo: c.rollNo, status: 'ACTIVE', ...(family ? {} : { userId: null }) } });
      const sameDob = (s: { dob: Date | null }) => (s.dob && c.dob ? s.dob.toISOString().slice(0, 10) === c.dob.toISOString().slice(0, 10) : false);
      // family accounts need the date of birth on the school record (a classmate knows names and roll numbers); otherwise the teacher decides
      const exact = candidates.filter((s) => (sameDob(s) && nameSimilarity(s.name, c.name) >= (family ? 0.5 : 0)) || (!family && !s.dob && nameSimilarity(s.name, c.name) >= 0.67));
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
    if (s.schoolId !== c.schoolId) throw new BadRequestException('Student is in another school');
    if (c.user.role === 'PARENT') return this.linkFamily(c, s, reviewerId);
    if (s.userId && s.userId !== c.userId) throw new ConflictException(`${s.name} is already linked to another account`);
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

  /**
   * Parent / Student (family) account: a child is linked through a guardian row that belongs only to this
   * account (never matched by phone: the phone typed at sign-up is not verified). One account, many children.
   */
  private async linkFamily(c: { id: string; userId: string; user: { name: string; email: string | null; schoolId: string | null } }, s: { id: string; schoolId: string; name: string; rollNo: string; section: { name: string; schoolClass: { name: string } } }, reviewerId: string | null) {
    const key = `acct:${c.userId}`;
    await this.prisma.$transaction(async (tx) => {
      const g = await tx.guardian.upsert({ where: { schoolId_phone: { schoolId: s.schoolId, phone: key } }, update: { userId: c.userId }, create: { schoolId: s.schoolId, phone: key, name: c.user.name, userId: c.userId } });
      await tx.studentGuardian.upsert({ where: { studentId_guardianId: { studentId: s.id, guardianId: g.id } }, update: {}, create: { studentId: s.id, guardianId: g.id, relation: 'family-account' } });
      await tx.claimRequest.update({ where: { id: c.id }, data: { status: 'APPROVED', matchedStudentId: s.id, reviewedById: reviewerId, reviewedAt: new Date(), rejectReason: null } });
      if (!c.user.schoolId) await tx.user.update({ where: { id: c.userId }, data: { schoolId: s.schoolId } });
    });
    await this.audit.record({ schoolId: s.schoolId, actorId: reviewerId, action: reviewerId ? 'family.link-approved' : 'family.auto-linked', entity: 'student', entityId: s.id, after: { userId: c.userId, claimId: c.id } });
    await this.notifications.notify([c.userId], {
      type: 'ACCOUNT',
      title: 'Child linked',
      body: `${s.name} (${s.section.schoolClass.name} ${s.section.name}, roll ${s.rollNo}) is now on your account. Checked copies and marks will appear here.`,
    });
    if (c.user.email && reviewerId) {
      await this.mail
        .send({
          to: c.user.email,
          toName: c.user.name,
          subject: `${s.name} is linked to your LaalPen account`,
          heading: 'Request approved',
          paragraphs: [`Assalam o Alaikum ${c.user.name},`, `The school approved your request. ${s.name} (${s.section.schoolClass.name} ${s.section.name}, roll ${s.rollNo}) is now on your account.`, 'Open LaalPen to see test names, dates, marks and checked copies.'],
          button: { label: 'Open LaalPen', url: env.appUrl },
        })
        .catch(() => undefined);
    }
  }

  // ---------- family account: one code box (class code / school code / card code, detected) ----------

  /** What kind of code is this? A card code names one child; a class or school code needs the child's details. */
  async detectCode(code: string) {
    const card = (await this.roster.useClaimCode(code, 'STUDENT', false)) ?? (await this.roster.useClaimCode(code, 'PARENT', false));
    if (card) {
      const st = await this.prisma.studentProfile.findUniqueOrThrow({ where: { id: card.id }, include: { section: { include: { schoolClass: { include: { school: true } } } } } });
      return { kind: 'card' as const, child: { name: st.name, className: st.section.schoolClass.name, sectionName: st.section.name, rollNo: st.rollNo, school: st.section.schoolClass.school.name } };
    }
    try {
      return { kind: 'class' as const, school: await this.lookup(code) };
    } catch {
      throw new NotFoundException('This code is not right. Check it with the teacher, e.g. ALN-9A (class code) or K7QP-3MXA (card code).');
    }
  }

  async familyLink(userId: string, dto: { code: string; childName?: string; rollNo?: string; dob?: string; sectionId?: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'PARENT') throw new ForbiddenException('Only Parent / Student accounts link a child here');
    const recent = await this.prisma.claimRequest.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (recent >= 10) throw new BadRequestException('Too many requests. Please try again later or ask the school.');
    for (const kind of ['STUDENT', 'PARENT'] as const) {
      const peek = await this.roster.useClaimCode(dto.code, kind, false);
      if (!peek) continue;
      const s = await this.roster.useClaimCode(dto.code, kind, true);
      if (!s) break;
      const c = await this.prisma.claimRequest.create({ data: { schoolId: s.schoolId, sectionId: s.sectionId, userId, name: s.name, rollNo: s.rollNo, matchedStudentId: s.id } });
      await this.link(c.id, s.id, null);
      return { status: 'LINKED' as const, child: s.name };
    }
    if (!dto.childName?.trim() || !dto.rollNo?.trim()) throw new BadRequestException({ message: 'Enter your child’s name and roll number', code: 'NEED_CHILD_DETAILS' });
    const { section, schoolId } = await this.resolveSection(dto.code, dto.sectionId);
    const dup = await this.prisma.claimRequest.findFirst({ where: { userId, sectionId: section.id, rollNo: dto.rollNo.trim(), status: 'PENDING' } });
    if (dup) return { status: 'PENDING' as const, child: dup.name };
    const c = await this.prisma.claimRequest.create({
      data: { schoolId, sectionId: section.id, userId, name: dto.childName.trim(), rollNo: dto.rollNo.trim(), dob: dto.dob ? new Date(dto.dob) : null },
    });
    if (await this.tryAutoLink(c.id)) return { status: 'LINKED' as const, child: c.name };
    await this.notifications.notifySectionReviewers(section.id, {
      title: 'A parent wants to see results',
      body: `${user.name} asked to link ${c.name} (roll ${c.rollNo}) in ${section.schoolClass.name} ${section.name}. Approve only if this is the right family.`,
    });
    return { status: 'PENDING' as const, child: c.name };
  }

  async familyRequests(userId: string) {
    const rows = await this.prisma.claimRequest.findMany({ where: { userId, status: { in: ['PENDING', 'REJECTED'] } }, orderBy: { createdAt: 'desc' }, take: 10, include: { section: { include: { schoolClass: { include: { school: true } } } } } });
    return rows.map((c) => ({ id: c.id, name: c.name, rollNo: c.rollNo, status: c.status, rejectReason: c.rejectReason, className: c.section.schoolClass.name, sectionName: c.section.name, school: c.section.schoolClass.school.name, createdAt: c.createdAt }));
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
    if (reviewer.role === 'PRINCIPAL') return { schoolId: reviewer.schoolId ?? '' };
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
