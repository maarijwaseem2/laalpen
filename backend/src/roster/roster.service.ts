import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { encryptField, humanCode } from '../common/crypto.js';
import { normalizePkPhone } from '../common/phone.js';
import { sha256 } from '../common/util.js';
import type { AuthUser } from '../common/decorators.js';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
type Db = PrismaService | Tx;

export interface RosterInput {
  name: string;
  rollNo: string;
  sectionId: string;
  admissionNo?: string | null;
  fatherName?: string | null;
  dob?: Date | null;
  gender?: string | null;
  bForm?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
}

export const normName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** 0..1 similarity of two names (token overlap), good enough to suggest "is this the same student?" */
export function nameSimilarity(a: string, b: string) {
  const ta = new Set(normName(a).split(' ').filter(Boolean));
  const tb = new Set(normName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t) || [...tb].some((x) => x.length > 3 && (x.startsWith(t) || t.startsWith(x)))) common++;
  return common / Math.max(ta.size, tb.size);
}

/**
 * The school roster: the admin's (or teacher's) list of students is the source of truth.
 * A student does not need an app account to have copies checked; accounts are linked later ("claim").
 */
@Injectable()
export class RosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- academic sessions ----------

  /** The school's current session; created on first use (April–March year). */
  async currentSession(schoolId: string, db: Db = this.prisma) {
    const cur = await db.academicSession.findFirst({ where: { schoolId, isCurrent: true } });
    if (cur) return cur;
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const name = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
    return db.academicSession.upsert({
      where: { schoolId_name: { schoolId, name } },
      update: { isCurrent: true },
      create: { schoolId, name, startsOn: new Date(Date.UTC(year, 3, 1)), isCurrent: true },
    });
  }

  async sessions(schoolId: string) {
    const rows = await this.prisma.academicSession.findMany({ where: { schoolId }, orderBy: { startsOn: 'desc' }, include: { _count: { select: { enrollments: true, tests: true } } } });
    if (!rows.length) return [await this.currentSession(schoolId)].map((s) => ({ ...s, enrollments: 0, tests: 0 }));
    return rows.map((s) => ({ id: s.id, name: s.name, startsOn: s.startsOn, endsOn: s.endsOn, isCurrent: s.isCurrent, enrollments: s._count.enrollments, tests: s._count.tests }));
  }

  async createSession(schoolId: string, name: string, startsOn: Date, makeCurrent: boolean) {
    const exists = await this.prisma.academicSession.findUnique({ where: { schoolId_name: { schoolId, name } } });
    if (exists) throw new ConflictException(`Session ${name} already exists`);
    return this.prisma.$transaction(async (tx) => {
      if (makeCurrent) await tx.academicSession.updateMany({ where: { schoolId }, data: { isCurrent: false } });
      return tx.academicSession.create({ data: { schoolId, name, startsOn, isCurrent: makeCurrent } });
    });
  }

  // ---------- students ----------

  private async section(schoolId: string, sectionId: string, db: Db = this.prisma) {
    const s = await db.section.findUnique({ where: { id: sectionId }, include: { schoolClass: true } });
    if (!s || s.schoolClass.schoolId !== schoolId) throw new NotFoundException('Section not found');
    return s;
  }

  async rollTaken(sectionId: string, rollNo: string, exceptId?: string, db: Db = this.prisma) {
    return db.studentProfile.findFirst({ where: { sectionId, rollNo, status: 'ACTIVE', ...(exceptId ? { id: { not: exceptId } } : {}) } });
  }

  /** Links the parent's phone to the student (one phone = one guardian for all their children). */
  async linkGuardian(db: Db, schoolId: string, studentId: string, phone?: string | null, name?: string | null) {
    const e164 = normalizePkPhone(phone);
    if (!e164) return null;
    const g = await db.guardian.upsert({
      where: { schoolId_phone: { schoolId, phone: e164 } },
      update: name ? { name } : {},
      create: { schoolId, phone: e164, name: name || null },
    });
    await db.studentGuardian.upsert({ where: { studentId_guardianId: { studentId, guardianId: g.id } }, update: {}, create: { studentId, guardianId: g.id } });
    return g;
  }

  /** Adds one roster student (no app account needed). */
  async createStudent(schoolId: string, input: RosterInput, actor?: AuthUser, db: Db = this.prisma) {
    const section = await this.section(schoolId, input.sectionId, db);
    if (await this.rollTaken(section.id, input.rollNo, undefined, db)) throw new ConflictException(`Roll number ${input.rollNo} is already used in ${section.schoolClass.name} ${section.name}`);
    if (input.admissionNo && (await db.studentProfile.findUnique({ where: { schoolId_admissionNo: { schoolId, admissionNo: input.admissionNo } } }))) {
      throw new ConflictException(`Admission number ${input.admissionNo} already exists`);
    }
    const session = await this.currentSession(schoolId, db);
    const bForm = input.bForm?.replace(/\D/g, '');
    const p = await db.studentProfile.create({
      data: {
        schoolId,
        name: input.name.trim(),
        rollNo: input.rollNo.trim(),
        sectionId: section.id,
        admissionNo: input.admissionNo?.trim() || null,
        fatherName: input.fatherName?.trim() || null,
        dob: input.dob ?? null,
        gender: input.gender ?? null,
        bFormEnc: bForm ? encryptField(bForm, 'bform') : null,
        bFormLast4: bForm ? bForm.slice(-4) : null,
        guardianName: input.guardianName?.trim() || null,
        guardianEmail: input.guardianEmail?.trim().toLowerCase() || null,
        guardianPhone: normalizePkPhone(input.guardianPhone) ?? input.guardianPhone ?? null,
        createdById: actor?.id ?? null,
        enrollments: { create: { sessionId: session.id, sectionId: section.id, rollNo: input.rollNo.trim() } },
      },
    });
    await this.linkGuardian(db, schoolId, p.id, input.guardianPhone, input.guardianName);
    return p;
  }

  async updateStudent(schoolId: string, id: string, patch: Partial<RosterInput>, actor: AuthUser) {
    const p = await this.prisma.studentProfile.findUnique({ where: { id } });
    if (!p || p.schoolId !== schoolId) throw new NotFoundException('Student not found');
    const sectionId = patch.sectionId ?? p.sectionId;
    if (patch.sectionId) await this.section(schoolId, patch.sectionId);
    if ((patch.sectionId || patch.rollNo) && (await this.rollTaken(sectionId, patch.rollNo ?? p.rollNo, p.id))) {
      throw new ConflictException(`Roll number ${patch.rollNo ?? p.rollNo} is already used in this section`);
    }
    const bForm = patch.bForm?.replace(/\D/g, '');
    const data: Record<string, unknown> = {};
    for (const k of ['name', 'rollNo', 'admissionNo', 'fatherName', 'gender', 'guardianName', 'guardianEmail'] as const) if (patch[k] !== undefined) data[k] = patch[k] || null;
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.rollNo !== undefined) data.rollNo = patch.rollNo;
    if (patch.dob !== undefined) data.dob = patch.dob;
    if (patch.sectionId) data.sectionId = patch.sectionId;
    if (patch.guardianPhone !== undefined) data.guardianPhone = normalizePkPhone(patch.guardianPhone) ?? patch.guardianPhone ?? null;
    if (bForm) Object.assign(data, { bFormEnc: encryptField(bForm, 'bform'), bFormLast4: bForm.slice(-4) });
    const updated = await this.prisma.studentProfile.update({ where: { id }, data });
    if (patch.sectionId || patch.rollNo) {
      const session = await this.currentSession(schoolId);
      await this.prisma.enrollment.upsert({
        where: { studentId_sessionId: { studentId: id, sessionId: session.id } },
        update: { sectionId: updated.sectionId, rollNo: updated.rollNo },
        create: { studentId: id, sessionId: session.id, sectionId: updated.sectionId, rollNo: updated.rollNo },
      });
    }
    if (patch.guardianPhone) await this.linkGuardian(this.prisma, schoolId, id, patch.guardianPhone, patch.guardianName);
    await this.audit.record({ schoolId, actorId: actor.id, actorRole: actor.role, action: 'student.update', entity: 'student', entityId: id, before: pick(p, Object.keys(data)), after: pick(updated, Object.keys(data)) });
    return updated;
  }

  /** "Mark as left": never deletes marks; the student just stops appearing in class lists. */
  async markLeft(schoolId: string, id: string, actor: AuthUser, reason?: string) {
    const p = await this.prisma.studentProfile.findUnique({ where: { id } });
    if (!p || p.schoolId !== schoolId) throw new NotFoundException('Student not found');
    await this.prisma.studentProfile.update({ where: { id }, data: { status: 'LEFT' } });
    await this.prisma.enrollment.updateMany({ where: { studentId: id, state: 'ACTIVE' }, data: { state: 'LEFT', endedAt: new Date() } });
    await this.audit.record({ schoolId, actorId: actor.id, actorRole: actor.role, action: 'student.left', entity: 'student', entityId: id, reason });
    return { ok: true };
  }

  async rejoin(schoolId: string, id: string, actor: AuthUser) {
    const p = await this.prisma.studentProfile.findUnique({ where: { id } });
    if (!p || p.schoolId !== schoolId) throw new NotFoundException('Student not found');
    if (await this.rollTaken(p.sectionId, p.rollNo, p.id)) throw new ConflictException(`Roll ${p.rollNo} is now used by another student; change the roll number first`);
    const session = await this.currentSession(schoolId);
    await this.prisma.studentProfile.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.prisma.enrollment.upsert({ where: { studentId_sessionId: { studentId: id, sessionId: session.id } }, update: { state: 'ACTIVE', endedAt: null, sectionId: p.sectionId, rollNo: p.rollNo }, create: { studentId: id, sessionId: session.id, sectionId: p.sectionId, rollNo: p.rollNo } });
    await this.audit.record({ schoolId, actorId: actor.id, actorRole: actor.role, action: 'student.rejoin', entity: 'student', entityId: id });
    return { ok: true };
  }

  /**
   * Teacher quick-add for academies without a register: one student per line,
   * "01 Ali Raza" or "01, Ali Raza, 0300 1234567".
   */
  async quickAdd(actor: AuthUser, sectionId: string, text: string) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId }, include: { schoolClass: true, teaching: { select: { teacherId: true } } } });
    if (!section || section.schoolClass.schoolId !== actor.schoolId) throw new NotFoundException('Section not found');
    if (actor.role === 'TEACHER' && !section.teaching.some((t) => t.teacherId === actor.id)) throw new ForbiddenException('You do not teach this section');
    const created: { rollNo: string; name: string }[] = [];
    const skipped: { line: string; reason: string }[] = [];
    for (const raw of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200)) {
      const parts = raw.includes(',') || raw.includes('\t') ? raw.split(/[,\t]/).map((x) => x.trim()) : [raw.match(/^\S+/)?.[0] ?? '', raw.replace(/^\S+\s*/, '')];
      let [roll, name, phone] = parts;
      if (!/\d/.test(roll ?? '') && /\d/.test(name ?? '')) [roll, name] = [name, roll];
      if (!roll || !name || name.length < 2) {
        skipped.push({ line: raw, reason: 'Write the roll number, then the name' });
        continue;
      }
      try {
        await this.createStudent(actor.schoolId!, { sectionId, rollNo: roll.replace(/^roll\s*/i, ''), name, guardianPhone: phone }, actor);
        created.push({ rollNo: roll, name });
      } catch (e) {
        skipped.push({ line: raw, reason: (e as Error).message });
      }
    }
    if (created.length) await this.audit.record({ schoolId: actor.schoolId, actorId: actor.id, actorRole: actor.role, action: 'roster.quick-add', entity: 'section', entityId: sectionId, after: { created: created.length } });
    return { created, skipped };
  }

  // ---------- codes ----------

  /** Per-section join code (rotatable, expires) — replaces the single school-wide code that leaks into WhatsApp groups. */
  async rotateSectionCode(schoolId: string, sectionId: string, days = 30) {
    const s = await this.section(schoolId, sectionId);
    const prefix = `${s.schoolClass.name.replace(/[^0-9A-Za-z]/g, '').replace(/^class/i, '').slice(0, 3)}${s.name.replace(/[^0-9A-Za-z]/g, '').slice(0, 2)}`.toUpperCase() || 'SEC';
    for (let i = 0; i < 10; i++) {
      const code = `${prefix}-${humanCode(6)}`;
      if (!(await this.prisma.section.findUnique({ where: { joinCode: code } }))) {
        return this.prisma.section.update({ where: { id: sectionId }, data: { joinCode: code, joinCodeExpiresAt: new Date(Date.now() + days * 86_400_000) }, select: { id: true, joinCode: true, joinCodeExpiresAt: true } });
      }
    }
    throw new ConflictException('Could not make a code, try again');
  }

  /** One-time codes printed on claim cards. Old unused codes of the same kind stop working. */
  async newClaimCodes(schoolId: string, studentIds: string[], kind: 'STUDENT' | 'PARENT', days = 60) {
    const students = await this.prisma.studentProfile.findMany({ where: { id: { in: studentIds }, schoolId, status: 'ACTIVE' }, include: { section: { include: { schoolClass: true } } }, orderBy: [{ sectionId: 'asc' }, { rollNo: 'asc' }] });
    const out: { studentId: string; name: string; className: string; sectionName: string; rollNo: string; code: string }[] = [];
    for (const s of students) {
      await this.prisma.claimCode.updateMany({ where: { studentId: s.id, kind, usedAt: null }, data: { usedAt: new Date() } });
      const code = humanCode(8);
      await this.prisma.claimCode.create({ data: { studentId: s.id, kind, codeHash: sha256(`claim:${code}`), expiresAt: new Date(Date.now() + days * 86_400_000) } });
      out.push({ studentId: s.id, name: s.name, className: s.section.schoolClass.name, sectionName: s.section.name, rollNo: s.rollNo, code: `${code.slice(0, 4)}-${code.slice(4)}` });
    }
    return out;
  }

  /** Finds the student behind a claim code (and marks it used when `consume`). */
  async useClaimCode(code: string, kind: 'STUDENT' | 'PARENT', consume: boolean) {
    const clean = code.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const row = await this.prisma.claimCode.findUnique({ where: { codeHash: sha256(`claim:${clean}`) }, include: { student: { include: { section: { include: { schoolClass: true } } } } } });
    if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date() || row.student.status !== 'ACTIVE') return null;
    if (consume) {
      const used = await this.prisma.claimCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!used.count) return null;
    }
    return row.student;
  }

  // ---------- year-end promotion ----------

  /**
   * Promote a class: every student moves to the next class (in a new session) except the ones the admin
   * unticked (they repeat the class); a top class "graduates". History stays in Enrollment, so old marks
   * keep their year.
   */
  async promote(
    schoolId: string,
    actor: AuthUser,
    dto: { fromClassId: string; toClassId?: string | null; sessionName: string; retainIds?: string[]; renumber?: boolean; dryRun?: boolean },
  ) {
    const from = await this.prisma.schoolClass.findUnique({ where: { id: dto.fromClassId }, include: { sections: true } });
    if (!from || from.schoolId !== schoolId) throw new NotFoundException('Class not found');
    const to = dto.toClassId ? await this.prisma.schoolClass.findUnique({ where: { id: dto.toClassId }, include: { sections: true } }) : null;
    if (dto.toClassId && (!to || to.schoolId !== schoolId)) throw new NotFoundException('Next class not found');
    if (to && to.id === from.id) throw new BadRequestException('Choose a different class to promote into');
    const students = await this.prisma.studentProfile.findMany({ where: { sectionId: { in: from.sections.map((s) => s.id) }, status: 'ACTIVE' }, orderBy: [{ sectionId: 'asc' }, { rollNo: 'asc' }] });
    const retain = new Set(dto.retainIds ?? []);
    const moving = students.filter((s) => !retain.has(s.id));
    if (to) {
      // students still sitting in the next class must be promoted first (start with the top class)
      const busy = await this.prisma.studentProfile.count({ where: { sectionId: { in: to.sections.map((s) => s.id) }, status: 'ACTIVE' } });
      if (busy && !dto.dryRun) throw new BadRequestException(`${to.name} still has ${busy} students. Promote ${to.name} first (start with the top class).`);
    }
    const plan = {
      from: from.name,
      to: to?.name ?? 'Graduated',
      session: dto.sessionName,
      promote: moving.length,
      repeat: retain.size,
      students: students.map((s) => ({ id: s.id, name: s.name, rollNo: s.rollNo, action: retain.has(s.id) ? 'repeat' : to ? 'promote' : 'graduate' })),
    };
    if (dto.dryRun) return plan;

    await this.prisma.$transaction(async (tx) => {
      let session = await tx.academicSession.findUnique({ where: { schoolId_name: { schoolId, name: dto.sessionName } } });
      if (!session) {
        const year = Number(dto.sessionName.slice(0, 4)) || new Date().getFullYear();
        await tx.academicSession.updateMany({ where: { schoolId }, data: { isCurrent: false } });
        session = await tx.academicSession.create({ data: { schoolId, name: dto.sessionName, startsOn: new Date(Date.UTC(year, 3, 1)), isCurrent: true } });
      }
      const sectionFor = async (name: string) => {
        if (!to) return null;
        const hit = to.sections.find((s) => s.name === name) ?? (await tx.section.findUnique({ where: { classId_name: { classId: to.id, name } } }));
        return hit ?? (await tx.section.create({ data: { classId: to.id, name } }));
      };
      const bySection = new Map<string, number>();
      for (const s of students) {
        const fromSection = from.sections.find((x) => x.id === s.sectionId)!;
        await tx.enrollment.updateMany({ where: { studentId: s.id, state: 'ACTIVE', sessionId: { not: session.id } }, data: { state: retain.has(s.id) ? 'ACTIVE' : to ? 'PROMOTED' : 'GRADUATED', endedAt: new Date() } });
        if (retain.has(s.id)) {
          await tx.enrollment.upsert({ where: { studentId_sessionId: { studentId: s.id, sessionId: session.id } }, update: { sectionId: s.sectionId, rollNo: s.rollNo, state: 'ACTIVE' }, create: { studentId: s.id, sessionId: session.id, sectionId: s.sectionId, rollNo: s.rollNo } });
          continue;
        }
        if (!to) {
          await tx.studentProfile.update({ where: { id: s.id }, data: { status: 'GRADUATED' } });
          continue;
        }
        const target = (await sectionFor(fromSection.name))!;
        const n = (bySection.get(target.id) ?? 0) + 1;
        bySection.set(target.id, n);
        const roll = dto.renumber ? String(n).padStart(2, '0') : s.rollNo;
        await tx.studentProfile.update({ where: { id: s.id }, data: { sectionId: target.id, rollNo: roll } });
        await tx.enrollment.upsert({ where: { studentId_sessionId: { studentId: s.id, sessionId: session.id } }, update: { sectionId: target.id, rollNo: roll, state: 'ACTIVE' }, create: { studentId: s.id, sessionId: session.id, sectionId: target.id, rollNo: roll } });
      }
    });
    await this.audit.record({ schoolId, actorId: actor.id, actorRole: actor.role, action: 'roster.promote', entity: 'class', entityId: from.id, after: { to: plan.to, session: dto.sessionName, promote: plan.promote, repeat: plan.repeat } });
    return plan;
  }
}

function pick(o: Record<string, any>, keys: string[]) {
  return Object.fromEntries(keys.filter((k) => !k.endsWith('Enc')).map((k) => [k, o[k] instanceof Date ? o[k].toISOString() : o[k]]));
}
