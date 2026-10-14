import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { AiClient, type AiScanResult } from '../checking/ai-client.js';
import { CaptureService } from '../capture/capture.service.js';
import { CardsService } from '../roster/cards.service.js';
import { AuditService } from '../audit/audit.service.js';
import { normalizePage } from '../common/images.js';
import { round1 } from '../common/util.js';
import type { AuthUser } from '../common/decorators.js';
import { SheetsService, type QrInfo } from './sheets.service.js';
import { LETTERS, MAX_OMR_QUESTIONS } from './omr-layout.js';

export interface StackFile { buffer: Buffer; originalname: string; mimetype: string }

/** "B", "b)", "(B) 12 m/s", "Option B" → "B" */
export function mcqLetter(v: string | null | undefined, options = 8): string | null {
  const t = (v ?? '').trim().toUpperCase();
  const m = t.match(/^\(?([A-H])\)?(?:[\s).:-]|$)/) ?? t.match(/^OPTION\s+([A-H])\b/);
  const letter = m?.[1] ?? null;
  return letter && LETTERS.indexOf(letter) < options ? letter : null;
}

/**
 * The pile of copies, photographed in any order. Every photo is matched to its student and page by the
 * signed QR code; OMR sheets are marked straight away (multiple choice needs no AI).
 */
@Injectable()
export class ScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiClient,
    private readonly capture: CaptureService,
    private readonly sheets: SheetsService,
    private readonly cards: CardsService,
    private readonly audit: AuditService,
  ) {}

  private async ownTest(u: AuthUser, testId: string) {
    const t = await this.prisma.test.findUnique({
      where: { id: testId },
      include: { questions: { orderBy: { number: 'asc' } }, assignment: { include: { subject: { include: { school: true } }, section: { include: { schoolClass: true } } } } },
    });
    if (!t || t.assignment.teacherId !== u.id) throw new NotFoundException('Test not found');
    return t;
  }

  private sheetTest(t: Awaited<ReturnType<ScanService['ownTest']>>) {
    return { id: t.id, title: t.title, subject: t.assignment.subject.name, className: t.assignment.section.schoolClass.name, sectionName: t.assignment.section.name, school: t.assignment.subject.school.name };
  }

  private async students(t: { assignment: { sectionId: string } }, ids?: string[]) {
    return this.prisma.studentProfile.findMany({
      where: { sectionId: t.assignment.sectionId, status: 'ACTIVE', ...(ids?.length ? { id: { in: ids } } : {}) },
      orderBy: { rollNo: 'asc' },
      select: { id: true, name: true, rollNo: true },
    });
  }

  // ---------- printing ----------

  async booklets(u: AuthUser, testId: string, opts: { format?: 'booklet' | 'stickers'; pages?: number; studentIds?: string[] }) {
    const t = await this.ownTest(u, testId);
    const students = await this.students(t, opts.studentIds);
    if (!students.length) throw new BadRequestException('No students in this class yet');
    const pages = Math.min(20, Math.max(1, opts.pages ?? t.expectedPages ?? 2));
    const pdf = opts.format === 'stickers' ? await this.sheets.stickersPdf(this.sheetTest(t), students, pages) : await this.sheets.bookletPdf(this.sheetTest(t), students, pages);
    const file = await this.cards.publish(`exports/${t.assignment.subject.schoolId}/${opts.format ?? 'booklet'}-${testId}-${Date.now()}.pdf`, pdf, 'application/pdf');
    return { url: file.url, students: students.length, pages };
  }

  private mcqQuestions(t: Awaited<ReturnType<ScanService['ownTest']>>) {
    if (t.questions.some((q) => q.type !== 'MCQ')) throw new BadRequestException('OMR sheets are for tests where every question is multiple choice');
    if (t.questions.length > MAX_OMR_QUESTIONS) throw new BadRequestException(`OMR sheets hold up to ${MAX_OMR_QUESTIONS} questions`);
    const k = Math.min(8, Math.max(2, ...t.questions.map((q) => (q.options?.length ? q.options.length : 4))));
    const missing = t.questions.find((q) => !mcqLetter(q.finalAnswer ?? q.answerKey, k));
    if (missing) throw new BadRequestException(`Question ${missing.number}: set the correct option (A, B, C …) in the answer key first`);
    return { n: t.questions.length, k };
  }

  async omrSheets(u: AuthUser, testId: string, studentIds?: string[]) {
    const t = await this.ownTest(u, testId);
    const { n, k } = this.mcqQuestions(t);
    const students = await this.students(t, studentIds);
    if (!students.length) throw new BadRequestException('No students in this class yet');
    const pdf = await this.sheets.omrPdf(this.sheetTest(t), students, n, k);
    const file = await this.cards.publish(`exports/${t.assignment.subject.schoolId}/omr-${testId}-${Date.now()}.pdf`, pdf, 'application/pdf');
    return { url: file.url, students: students.length, questions: n, options: k };
  }

  // ---------- the pile of photos ----------

  async stack(u: AuthUser, testId: string, files: StackFile[]) {
    const t = await this.ownTest(u, testId);
    if (t.keyStatus !== 'CONFIRMED') throw new BadRequestException({ message: 'Confirm the answer key first, then upload copies.', code: 'KEY_NOT_CONFIRMED' });
    if (!files?.length) throw new BadRequestException('Add the photos of the copies');
    if (files.length > 80) throw new BadRequestException('Up to 80 photos at a time');
    const results = await this.ai.scan(files.map((f, i) => ({ pageNo: i + 1, data: f.buffer, filename: f.originalname || `photo-${i + 1}.jpg` })));
    const roster = new Map((await this.students(t)).map((s) => [s.id, s]));
    const schoolId = t.schoolId ?? t.assignment.subject.schoolId;

    const copies = new Map<string, { page: number; idx: number; text: string }[]>();
    const omr: { idx: number; info: QrInfo; res: AiScanResult }[] = [];
    const unmatched: { index: number; filename: string; reason: string }[] = [];
    for (const r of results) {
      const info = this.sheets.verify(r.qr?.text);
      const reason = r.error ? r.error : !r.qr ? 'No LaalPen QR code found — photograph the whole page' : !info ? 'QR code is not from LaalPen' : info.testId !== testId ? 'This page belongs to another test' : !roster.has(info.studentId) ? 'Student is not in this class' : null;
      if (reason || !info) {
        unmatched.push({ index: r.index, filename: files[r.index]?.originalname ?? '', reason: reason ?? 'unreadable' });
        continue;
      }
      if (info.kind === 'omr') omr.push({ idx: r.index, info, res: r });
      else copies.set(info.studentId, [...(copies.get(info.studentId) ?? []), { page: info.page, idx: r.index, text: r.qr!.text }]);
    }

    // written copies: attach pages in page order (a repeated page keeps the last photo) and queue for checking
    const copyOut: { studentId: string; name: string; rollNo: string; pages: number; missing: number[] }[] = [];
    for (const [studentId, list] of copies) {
      const byPage = new Map(list.map((p) => [p.page, p]));
      const pages = [...byPage.values()].sort((a, b) => a.page - b.page);
      const keyed = [];
      for (const p of pages) {
        const f = files[p.idx];
        const localId = `qr-${createHash("sha256").update(`${testId}:${studentId}:`).update(f.buffer).digest("hex").slice(0, 24)}`;
        const key = `incoming/${schoolId}/${testId}/${studentId}/${localId}.jpg`;
        if (!(await this.prisma.page.findUnique({ where: { clientLocalId: localId } }))) await this.storage.save(key, f.buffer, f.mimetype || 'image/jpeg');
        keyed.push({ pageNo: p.page, localId, key, text: p.text });
      }
      await this.capture.confirm(u, { testId, studentId, pages: keyed.map(({ text, ...k }) => ({ ...k, qrCode: text })) }); // QR saved with the page, before the quality check runs
      for (const k of keyed) await this.prisma.page.updateMany({ where: { clientLocalId: k.localId }, data: { qrCode: k.text } });
      const s = roster.get(studentId)!;
      const expected = t.expectedPages ?? 0;
      const missing = Array.from({ length: Math.max(expected, ...pages.map((p) => p.page)) }, (_, i) => i + 1).filter((n) => !byPage.has(n));
      copyOut.push({ studentId, name: s.name, rollNo: s.rollNo, pages: pages.length, missing });
    }

    // OMR sheets: marked in code
    const omrOut: { studentId: string; name: string; rollNo: string; obtained: number; total: number; review: number }[] = [];
    for (const o of omr) {
      if (!o.res.omr) {
        unmatched.push({ index: o.idx, filename: files[o.idx]?.originalname ?? '', reason: 'Could not see the four black corner squares — photograph the whole sheet flat' });
        continue;
      }
      omrOut.push(await this.saveOmr(u, t, o.info.studentId, files[o.idx], o.res.omr.answers, roster.get(o.info.studentId)!));
    }
    await this.audit.record({ schoolId, actorId: u.id, actorRole: u.role, action: 'copies.stack-upload', entity: 'test', entityId: testId, after: { photos: files.length, copies: copyOut.length, omr: omrOut.length, unmatched: unmatched.length } });
    return { copies: copyOut, omr: omrOut, unmatched: unmatched.sort((a, b) => a.index - b.index) };
  }

  private async saveOmr(
    u: AuthUser,
    t: Awaited<ReturnType<ScanService['ownTest']>>,
    studentId: string,
    file: StackFile,
    answers: { question: number; choice: string | null; status: 'ok' | 'blank' | 'multiple' }[],
    student: { name: string; rollNo: string },
  ) {
    const { k } = this.mcqQuestions(t);
    const schoolId = t.schoolId ?? t.assignment.subject.schoolId;
    const existing = await this.prisma.submission.findUnique({ where: { testId_studentId: { testId: t.id, studentId } } });
    if (existing?.status === 'APPROVED') throw new BadRequestException(`${student.name}'s copy is already approved`);
    const sub = existing ?? (await this.prisma.submission.create({ data: { testId: t.id, studentId, schoolId } }));
    const { data, width, height } = await normalizePage(file.buffer);
    const key = `submissions/${sub.id}/omr-${Date.now()}.jpg`;
    await this.storage.save(key, data);
    let obtained = 0;
    let review = 0;
    const rows = t.questions.map((q, i) => {
      const a = answers[i] ?? { choice: null, status: 'blank' as const };
      const correct = mcqLetter(q.finalAnswer ?? q.answerKey, k);
      const ok = a.status === 'ok' && a.choice === correct;
      if (ok) obtained += q.maxMarks;
      if (a.status === 'multiple') review++;
      return {
        submissionId: sub.id,
        questionId: q.id,
        transcription: a.choice,
        aiMarks: ok ? q.maxMarks : 0,
        finalMarks: ok ? q.maxMarks : 0,
        reason: a.status === 'blank' ? 'Left blank' : a.status === 'multiple' ? 'More than one circle filled' : ok ? `Correct (${correct})` : `Marked ${a.choice}, answer is ${correct}`,
        comment: ok || a.status === 'blank' ? null : a.status === 'multiple' ? 'Fill only one circle' : `Answer: ${correct}`,
        confidence: a.status === 'multiple' ? 0.4 : 0.99,
        reviewState: a.status === 'multiple' ? ('CHECK' as const) : ('SURE' as const),
        needsReview: a.status === 'multiple',
        isBlank: a.status === 'blank',
        method: 'omr',
        model: 'omr',
        keyVersion: t.keyVersion,
        pageNo: 1,
      };
    });
    await this.prisma.$transaction([
      this.prisma.answer.deleteMany({ where: { submissionId: sub.id } }),
      this.prisma.page.deleteMany({ where: { submissionId: sub.id } }),
      this.prisma.problemCopy.updateMany({ where: { submissionId: sub.id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: u.id } }),
      this.prisma.page.create({ data: { submissionId: sub.id, pageNo: 1, originalPath: key, testId: t.id, width, height, qrCode: 'LP1-omr' } }),
      this.prisma.answer.createMany({ data: rows }),
      this.prisma.submission.update({
        where: { id: sub.id },
        data: {
          status: review ? 'NEEDS_REVIEW' : 'CHECKED',
          obtainedMarks: round1(obtained),
          aiSummary: `OMR sheet: ${rows.filter((r) => r.finalMarks > 0).length} of ${rows.length} correct.`,
          checkedAt: new Date(),
          qualityChecked: true,
          error: null,
          model: 'omr',
          keyVersion: t.keyVersion,
          checkRun: { increment: 1 },
        },
      }),
    ]);
    if (t.status === 'DRAFT') await this.prisma.test.update({ where: { id: t.id }, data: { status: 'ACTIVE' } });
    return { studentId, name: student.name, rollNo: student.rollNo, obtained: round1(obtained), total: t.totalMarks, review };
  }
}
