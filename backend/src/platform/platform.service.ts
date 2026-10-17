import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { MailService } from '../mail/mail.service.js';
import { AuditService } from '../audit/audit.service.js';
import { env } from '../config/env.js';
import type { AuthUser } from '../common/decorators.js';
import type { AddPrincipalDto, CreateSchoolDto } from './platform.dto.js';

/**
 * The LaalPen platform owner (SUPER_ADMIN). Only they create schools and each school's principal, and they
 * can pause a whole school or one account. They never see marks or copies through these endpoints: only counts.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async overview() {
    const [schools, suspended, principals, teachers, pendingTeachers, students, families] = await Promise.all([
      this.prisma.school.count(),
      this.prisma.school.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.user.count({ where: { role: 'PRINCIPAL' } }),
      this.prisma.user.count({ where: { role: 'TEACHER' } }),
      this.prisma.teacherProfile.count({ where: { status: 'PENDING' } }),
      this.prisma.studentProfile.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { role: { in: ['PARENT', 'STUDENT'] } } }),
    ]);
    return { schools, suspended, principals, teachers, pendingTeachers, students, families };
  }

  async schools(search?: string) {
    const rows = await this.prisma.school.findMany({
      where: search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { city: { contains: search, mode: 'insensitive' } }, { joinCode: { contains: search.toUpperCase() } }] } : {},
      orderBy: { createdAt: 'desc' },
      include: { users: { where: { role: 'PRINCIPAL' }, select: { id: true, name: true, email: true, isActive: true, emailVerified: true } } },
    });
    const counts = await this.prisma.user.groupBy({ by: ['schoolId'], where: { role: 'TEACHER', schoolId: { in: rows.map((r) => r.id) } }, _count: true });
    const studentCounts = await this.prisma.studentProfile.groupBy({ by: ['schoolId'], where: { status: 'ACTIVE', schoolId: { in: rows.map((r) => r.id) } }, _count: true });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      city: s.city,
      joinCode: s.joinCode,
      createdAt: s.createdAt,
      profileComplete: !!s.profileCompletedAt,
      suspended: !!s.suspendedAt,
      suspendReason: s.suspendReason,
      principals: s.users.map((u) => ({ id: u.id, name: u.name, email: u.email, isActive: u.isActive, signedIn: u.emailVerified })),
      teachers: counts.find((c) => c.schoolId === s.id)?._count ?? 0,
      students: studentCounts.find((c) => c.schoolId === s.id)?._count ?? 0,
    }));
  }

  async school(id: string) {
    const s = await this.prisma.school.findUnique({
      where: { id },
      include: {
        users: { where: { role: { in: ['PRINCIPAL', 'TEACHER'] } }, orderBy: [{ role: 'asc' }, { name: 'asc' }], select: { id: true, name: true, email: true, role: true, isActive: true, emailVerified: true, createdAt: true, teacherProfile: { select: { status: true } } } },
        classes: { orderBy: [{ grade: 'asc' }, { name: 'asc' }], include: { sections: { orderBy: { name: 'asc' }, select: { id: true, name: true } } } },
        _count: { select: { students: true, subjects: true } },
      },
    });
    if (!s) throw new NotFoundException('School not found');
    return {
      id: s.id,
      name: s.name,
      city: s.city,
      address: s.address,
      phone: s.phone,
      logoUrl: s.logoUrl,
      joinCode: s.joinCode,
      createdAt: s.createdAt,
      profileComplete: !!s.profileCompletedAt,
      suspended: !!s.suspendedAt,
      suspendReason: s.suspendReason,
      students: s._count.students,
      subjects: s._count.subjects,
      classes: s.classes.map((c) => ({ id: c.id, name: c.name, sections: c.sections.map((x) => x.name) })),
      staff: s.users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, signedIn: u.emailVerified, teacherStatus: u.teacherProfile?.status ?? null })),
    };
  }

  /** New school + its principal. The principal gets an invite email and fills in the school profile on first sign-in. */
  async createSchool(actor: AuthUser, dto: CreateSchoolDto) {
    if (await this.prisma.user.findUnique({ where: { email: dto.principalEmail } })) throw new ConflictException('An account with this email already exists. Use another email for the principal.');
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const school = await this.prisma.school.create({
      data: {
        name: dto.name,
        city: dto.city || null,
        joinCode: await this.auth.uniqueJoinCode(dto.name),
        createdById: actor.id,
        sessions: { create: { name: `${year}-${String((year + 1) % 100).padStart(2, '0')}`, startsOn: new Date(Date.UTC(year, 3, 1)), isCurrent: true } },
      },
    });
    const principal = await this.invitePrincipal(actor, school.id, school.name, { name: dto.principalName, email: dto.principalEmail });
    await this.audit.record({ schoolId: school.id, actorId: actor.id, actorRole: actor.role, action: 'school.created', entity: 'school', entityId: school.id, after: { name: school.name, principal: principal.email }, ip: actor.ip });
    return { ...(await this.school(school.id)), principal };
  }

  async addPrincipal(actor: AuthUser, schoolId: string, dto: AddPrincipalDto) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) throw new NotFoundException('School not found');
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw new ConflictException('An account with this email already exists');
    return this.invitePrincipal(actor, school.id, school.name, dto);
  }

  private async invitePrincipal(actor: AuthUser, schoolId: string, schoolName: string, p: { name: string; email: string }) {
    const user = await this.prisma.user.create({
      data: { schoolId, name: p.name, email: p.email, role: 'PRINCIPAL', emailVerified: false, invitedAt: new Date(), invitedById: actor.id },
      select: { id: true, name: true, email: true, role: true },
    });
    await this.mail.invite(p.email, p.name, 'PRINCIPAL', schoolName, 'LaalPen', `${env.appUrl.replace(/\/+$/, '')}/login?staff=1&email=${encodeURIComponent(p.email)}`);
    await this.audit.record({ schoolId, actorId: actor.id, actorRole: actor.role, action: 'principal.invited', entity: 'user', entityId: user.id, after: { email: p.email }, ip: actor.ip });
    return user;
  }

  async resendInvite(actor: AuthUser, userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, include: { school: true } });
    if (!u || u.role !== 'PRINCIPAL' || !u.email) throw new NotFoundException('Principal not found');
    await this.mail.invite(u.email, u.name, 'PRINCIPAL', u.school?.name ?? 'your school', 'LaalPen', `${env.appUrl.replace(/\/+$/, '')}/login?staff=1&email=${encodeURIComponent(u.email)}`);
    await this.prisma.user.update({ where: { id: u.id }, data: { invitedAt: new Date() } });
    return { ok: true };
  }

  async setSchoolSuspended(actor: AuthUser, id: string, suspended: boolean, reason?: string) {
    const s = await this.prisma.school.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('School not found');
    await this.prisma.school.update({ where: { id }, data: suspended ? { suspendedAt: new Date(), suspendReason: reason || null } : { suspendedAt: null, suspendReason: null } });
    if (suspended) {
      // sign out every staff member and student of this school right away
      const users = await this.prisma.user.findMany({ where: { schoolId: id, role: { in: ['PRINCIPAL', 'TEACHER', 'STUDENT'] } }, select: { id: true } });
      for (const u of users) await this.auth.revokeAll(u.id, 'school-suspended');
    }
    await this.audit.record({ schoolId: id, actorId: actor.id, actorRole: actor.role, action: suspended ? 'school.suspended' : 'school.restored', entity: 'school', entityId: id, reason: reason ?? null, ip: actor.ip });
    return this.school(id);
  }

  async setUserActive(actor: AuthUser, id: string, active: boolean) {
    if (id === actor.id) throw new BadRequestException('You cannot pause your own account');
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    if (u.role === 'SUPER_ADMIN') throw new BadRequestException('Another super admin cannot be paused here');
    await this.prisma.user.update({ where: { id }, data: { isActive: active } });
    if (!active) await this.auth.revokeAll(id, 'suspended-by-super-admin');
    await this.audit.record({ schoolId: u.schoolId, actorId: actor.id, actorRole: actor.role, action: active ? 'user.restored' : 'user.suspended', entity: 'user', entityId: id, ip: actor.ip });
    return { ok: true, isActive: active };
  }
}
