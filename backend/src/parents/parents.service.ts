import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { MessagingService } from '../messaging/messaging.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RosterService } from '../roster/roster.service.js';
import { StudentService, type StudentRef } from '../student/student.service.js';
import { maskPhone, normalizePkPhone } from '../common/phone.js';
import type { DeviceInfo } from '../auth/security.service.js';

/**
 * Parents sign in with the phone number the school has on file (no email needed). One verified phone
 * links every child with that number — brothers and sisters, even in different schools. Parent accounts
 * are read-only, so an SMS/WhatsApp code is acceptable here (it is identity linking, not 2FA).
 */
@Injectable()
export class ParentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    private readonly roster: RosterService,
    private readonly students: StudentService,
  ) {}

  /** Sends a code only if a school has this number; the answer is the same either way (no enumeration). */
  async start(rawPhone: string) {
    const phone = normalizePkPhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a Pakistani mobile number like 0300 1234567');
    const known = await this.prisma.guardian.count({ where: { phone } });
    if (known) {
      const code = await this.auth.issueOtp(phone, '', 'PHONE_LOGIN');
      await this.messaging.sendCode(phone, code);
    }
    return { ok: true, phone: maskPhone(phone), message: 'If your school has this number, we sent a 6-digit code by SMS/WhatsApp.' };
  }

  async verify(rawPhone: string, code: string, device: DeviceInfo) {
    const phone = normalizePkPhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a Pakistani mobile number like 0300 1234567');
    await this.auth.consumeOtp(phone, 'PHONE_LOGIN', code);
    const guardians = await this.prisma.guardian.findMany({ where: { phone }, orderBy: { createdAt: 'asc' } });
    if (!guardians.length) throw new BadRequestException('Incorrect code');
    let user = await this.prisma.user.findUnique({ where: { phoneE164: phone } });
    if (user && user.role !== 'PARENT') throw new ForbiddenException('This number belongs to a staff account. Sign in with email instead.');
    if (!user) {
      user = await this.prisma.user.create({
        data: { role: 'PARENT', name: guardians.find((g) => g.name)?.name ?? 'Parent', phoneE164: phone, phone, emailVerified: true, schoolId: guardians[0].schoolId },
      });
    }
    if (!user.isActive) throw new ForbiddenException('This account is disabled. Please contact the school.');
    await this.prisma.guardian.updateMany({ where: { phone, userId: null }, data: { userId: user.id } });
    await this.audit.record({ schoolId: guardians[0].schoolId, actorId: user.id, actorRole: 'PARENT', action: 'parent.login', entity: 'user', entityId: user.id, ip: device.ip });
    return this.auth.session(user.id, device, 'phone');
  }

  /** All children of this parent (every guardian row with this account). */
  async children(userId: string) {
    const links = await this.prisma.studentGuardian.findMany({
      // a school paused by LaalPen is hidden until it is restored
      where: { guardian: { userId }, student: { school: { suspendedAt: null } } },
      include: { student: { include: { section: { include: { schoolClass: true } }, school: { select: { id: true, name: true } } } } },
    });
    const seen = new Set<string>();
    return links
      .filter((l) => !seen.has(l.studentId) && seen.add(l.studentId))
      .map((l) => ({
        id: l.student.id,
        name: l.student.name,
        rollNo: l.student.rollNo,
        className: l.student.section.schoolClass.name,
        sectionName: l.student.section.name,
        school: l.student.school.name,
        status: l.student.status,
      }));
  }

  /** The child, only if this parent is linked to them. */
  async child(userId: string, studentId: string): Promise<StudentRef> {
    const link = await this.prisma.studentGuardian.findFirst({ where: { studentId, guardian: { userId }, student: { school: { suspendedAt: null } } }, include: { student: true } });
    if (!link) throw new NotFoundException('Child not found');
    const s = link.student;
    return { id: s.id, schoolId: s.schoolId, sectionId: s.sectionId, name: s.name, rollNo: s.rollNo };
  }

  /** The child of a submission, only if this parent is linked to them. */
  async childOfSubmission(userId: string, submissionId: string): Promise<StudentRef> {
    const sub = await this.prisma.submission.findUnique({ where: { id: submissionId }, select: { studentId: true } });
    if (!sub) throw new NotFoundException('Result not found');
    return this.child(userId, sub.studentId);
  }

  dashboard(ref: StudentRef) {
    return this.students.dashboard(ref);
  }

  /** "Add child" with the parent code from the school (when the phone on file was wrong). */
  async link(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phoneE164) throw new BadRequestException('Sign in with your phone number first');
    const s = await this.roster.useClaimCode(code, 'PARENT', true);
    if (!s) throw new BadRequestException('This code is wrong, used or expired. Ask the school for a new one.');
    const g = await this.roster.linkGuardian(this.prisma, s.schoolId, s.id, user.phoneE164, user.name);
    if (g) await this.prisma.guardian.update({ where: { id: g.id }, data: { userId } });
    await this.audit.record({ schoolId: s.schoolId, actorId: userId, actorRole: 'PARENT', action: 'parent.linked-by-code', entity: 'student', entityId: s.id });
    return this.children(userId);
  }
}
