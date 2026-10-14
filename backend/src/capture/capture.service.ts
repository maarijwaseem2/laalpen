import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { CheckingService, sha256Buffer } from '../checking/checking.service.js';
import { normalizePage } from '../common/images.js';
import type { AuthUser } from '../common/decorators.js';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Class capture sessions. The phone saves every page locally first, then uploads each one straight to
 * storage with a presigned link and confirms it here. Confirming is idempotent (the phone's page id),
 * so a retry after a dropped connection never creates duplicates. When a student's pages are complete
 * the copy goes to the bulk queue; the session sends one "class done" alert at the end.
 */
@Injectable()
export class CaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly checking: CheckingService,
  ) {}

  private async ownTest(u: AuthUser, testId: string) {
    const t = await this.prisma.test.findUnique({ where: { id: testId }, include: { assignment: { include: { subject: true } } } });
    if (!t || t.assignment.teacherId !== u.id) throw new NotFoundException('Test not found');
    if (t.keyStatus !== 'CONFIRMED') throw new BadRequestException({ message: 'Confirm the answer key first, then upload copies.', code: 'KEY_NOT_CONFIRMED' });
    return t;
  }

  private async student(t: { assignment: { sectionId: string } }, studentId: string) {
    const s = await this.prisma.studentProfile.findUnique({ where: { id: studentId } });
    if (!s || s.sectionId !== t.assignment.sectionId || s.status !== 'ACTIVE') throw new NotFoundException('Student is not in this class');
    return s;
  }

  /** Opens (or reuses) the teacher's capture session for this test. */
  async openBatch(u: AuthUser, testId: string) {
    const t = await this.ownTest(u, testId);
    const open = await this.prisma.gradingBatch.findFirst({ where: { testId, createdById: u.id, status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
    const b = open ?? (await this.prisma.gradingBatch.create({ data: { testId, createdById: u.id } }));
    if (t.status === 'DRAFT') await this.prisma.test.update({ where: { id: testId }, data: { status: 'ACTIVE' } });
    return this.progress(u, b.id);
  }

  async presign(u: AuthUser, dto: { testId: string; studentId: string; pageNo: number; localId: string; contentType?: string }) {
    const t = await this.ownTest(u, dto.testId);
    await this.student(t, dto.studentId);
    const type = dto.contentType && TYPES[dto.contentType] ? dto.contentType : 'image/jpeg';
    const existing = await this.prisma.page.findUnique({ where: { clientLocalId: dto.localId } });
    if (existing) return { alreadyUploaded: true, key: existing.originalPath };
    const key = `incoming/${t.assignment.subject.schoolId}/${dto.testId}/${dto.studentId}/${dto.localId}.${TYPES[type]}`;
    return { alreadyUploaded: false, key, ...(await this.storage.presignPut(key, type)) };
  }

  /**
   * The phone uploaded every page of one student: attach them to the copy and queue it.
   * Sending the same confirm twice is harmless.
   */
  async confirm(u: AuthUser, dto: { testId: string; studentId: string; batchId?: string; pages: { pageNo: number; localId: string; key: string; qrCode?: string }[] }) {
    const t = await this.ownTest(u, dto.testId);
    await this.student(t, dto.studentId);
    if (!dto.pages.length) throw new BadRequestException('No pages');
    const prefix = `incoming/${t.assignment.subject.schoolId}/${dto.testId}/${dto.studentId}/`;
    if (dto.pages.some((p) => !p.key.startsWith(prefix) || p.key.includes('..'))) throw new BadRequestException('Wrong upload key');
    if (new Set(dto.pages.map((p) => p.pageNo)).size !== dto.pages.length) throw new BadRequestException('Page numbers must be different');
    let batchId: string | null = null;
    if (dto.batchId) {
      const b = await this.prisma.gradingBatch.findUnique({ where: { id: dto.batchId } });
      if (!b || b.testId !== dto.testId || b.createdById !== u.id) throw new NotFoundException('Capture session not found');
      batchId = b.id;
    }

    const existing = await this.prisma.submission.findUnique({ where: { testId_studentId: { testId: dto.testId, studentId: dto.studentId } }, include: { pages: true } });
    if (existing?.status === 'APPROVED') throw new BadRequestException('This copy is already approved');
    const known = new Set(existing?.pages.map((p) => p.clientLocalId).filter(Boolean));
    const same = existing && existing.pages.length === dto.pages.length && dto.pages.every((p) => known.has(p.localId));
    if (same) return { submissionId: existing!.id, status: existing!.status, duplicate: true }; // repeat of a confirm we already did

    for (const p of dto.pages) {
      if (!known.has(p.localId) && !(await this.storage.exists(p.key))) throw new BadRequestException(`Page ${p.pageNo} has not finished uploading`);
    }
    const sub = existing ?? (await this.prisma.submission.create({ data: { testId: dto.testId, studentId: dto.studentId, schoolId: t.schoolId ?? t.assignment.subject.schoolId } }));
    // retake inside the same session: take the old outcome back out of the session's counters
    if (existing?.batchId && existing.batchCounted) {
      const col = existing.status === 'NEEDS_ATTENTION' ? 'problems' : existing.status === 'FAILED' ? 'failed' : 'done';
      await this.prisma.$executeRawUnsafe(`UPDATE "grading_batches" SET "${col}" = GREATEST(0, "${col}" - 1) WHERE "id" = $1`, existing.batchId);
    }
    await this.prisma.page.deleteMany({ where: { submissionId: sub.id, clientLocalId: { notIn: dto.pages.map((p) => p.localId) } } });
    await this.prisma.page.deleteMany({ where: { submissionId: sub.id, clientLocalId: null } });
    await this.prisma.answer.deleteMany({ where: { submissionId: sub.id } });
    await this.prisma.problemCopy.updateMany({ where: { submissionId: sub.id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: u.id } });
    for (const p of dto.pages) {
      if (known.has(p.localId)) {
        await this.prisma.page.update({ where: { clientLocalId: p.localId }, data: { pageNo: p.pageNo, ...(p.qrCode ? { qrCode: p.qrCode } : {}) } });
        continue;
      }
      const raw = await this.storage.read(p.key);
      const { data, width, height } = await normalizePage(raw).catch(() => {
        throw new BadRequestException(`Page ${p.pageNo} is not a readable photo`);
      });
      const key = `submissions/${sub.id}/page-${p.pageNo}-${p.localId.slice(0, 12)}.jpg`;
      await this.storage.save(key, data);
      await this.storage.remove(p.key);
      await this.prisma.page.upsert({
        where: { clientLocalId: p.localId },
        update: { pageNo: p.pageNo, originalPath: key, annotatedPath: null, width, height, sha256: sha256Buffer(data), testId: dto.testId, submissionId: sub.id, qrCode: p.qrCode ?? null },
        create: { submissionId: sub.id, pageNo: p.pageNo, originalPath: key, testId: dto.testId, sha256: sha256Buffer(data), width, height, clientLocalId: p.localId, qrCode: p.qrCode ?? null },
      });
    }
    await this.prisma.submission.update({
      where: { id: sub.id },
      data: { obtainedMarks: null, aiSummary: null, checkedAt: null, qualityChecked: false, qualityOverride: false, batchId, batchCounted: false },
    });
    if (t.status === 'DRAFT') await this.prisma.test.update({ where: { id: dto.testId }, data: { status: 'ACTIVE' } });
    await this.checking.enqueue(sub.id, batchId ? 'bulk' : 'interactive');
    return { submissionId: sub.id, status: 'PENDING', pages: dto.pages.length };
  }

  /** "Done with class": the session now knows how many copies to wait for. */
  async closeBatch(u: AuthUser, batchId: string) {
    const b = await this.prisma.gradingBatch.findUnique({ where: { id: batchId } });
    if (!b || b.createdById !== u.id) throw new NotFoundException('Capture session not found');
    if (b.status === 'OPEN') {
      const total = await this.prisma.submission.count({ where: { batchId } });
      await this.prisma.gradingBatch.update({ where: { id: batchId }, data: { status: 'CLOSED', total, closedAt: new Date() } });
      await this.checking.maybeFinishBatch(batchId);
    }
    return this.progress(u, batchId);
  }

  async progress(u: AuthUser, batchId: string) {
    const b = await this.prisma.gradingBatch.findUnique({ where: { id: batchId } });
    if (!b || b.createdById !== u.id) throw new NotFoundException('Capture session not found');
    const groups = await this.prisma.submission.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } });
    const n = (...s: string[]) => groups.filter((g) => s.includes(g.status)).reduce((x, g) => x + g._count._all, 0);
    const uploaded = groups.reduce((x, g) => x + g._count._all, 0);
    return {
      id: b.id,
      testId: b.testId,
      status: b.status,
      uploaded,
      total: b.status === 'OPEN' ? uploaded : b.total,
      checking: n('PENDING', 'PROCESSING'),
      done: b.done,
      failed: b.failed,
      problems: b.problems,
      ready: n('CHECKED'),
      review: n('NEEDS_REVIEW'),
      approved: n('APPROVED'),
      createdAt: b.createdAt,
      closedAt: b.closedAt,
    };
  }
}
