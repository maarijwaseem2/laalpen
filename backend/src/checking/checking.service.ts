import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AiClient, AiServiceError, type AiCheckPayload, type AiCheckResult, type AiPageFile, type AiQuestion, type AiQuality } from './ai-client.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { env } from '../config/env.js';
import { round1 } from '../common/util.js';
import type { ProblemType, ReviewState } from '../generated/prisma/enums.js';
import { reportError } from '../common/monitoring.js';

export const QUEUE_INTERACTIVE = 'check-interactive';
export const QUEUE_BULK = 'check-bulk';
export const QUEUE_DLQ = 'check-dlq';
export const QUEUE_OVERNIGHT_SUBMIT = 'overnight-submit';
export const QUEUE_OVERNIGHT_POLL = 'overnight-poll';
const LEGACY_QUEUE = 'check-copy';

export type CheckMode = 'interactive' | 'bulk';

const PROBLEM_TEXT: Record<string, { type: ProblemType; text: string }> = {
  blurry: { type: 'BLURRY', text: 'Photo is blurry' },
  dark: { type: 'DARK', text: 'Photo is too dark' },
  glare: { type: 'GLARE', text: 'Light glare hides part of the page' },
  cut_off: { type: 'CUT_OFF', text: 'Part of the page is cut off' },
  low_resolution: { type: 'LOW_RESOLUTION', text: 'Photo is too small to read' },
};
const DUPLICATE_DISTANCE = 4; // pHash bits: 0–4 = the same photo (re-sized / re-compressed)

/**
 * Is `mine` a re-upload of `other`'s photo?
 * Printed QR booklets are mostly the same blank template, so two different students' pages can have
 * nearly the same perceptual hash. When both pages carry a LaalPen QR code, the QR (student + page)
 * decides: different QR = different paper, never a duplicate. Otherwise the perceptual hash decides.
 */
export function looksDuplicate(mine: { phash: string | null; qrCode?: string | null }, other: { phash: string | null; qrCode?: string | null }) {
  if (!mine.phash || !other.phash) return false;
  const qr = (c?: string | null) => (c && c !== 'LP1-omr' ? c : null);
  const a = qr(mine.qrCode);
  const b = qr(other.qrCode);
  if (a && b && a !== b) return false;
  return hammingHex(mine.phash, other.phash) <= DUPLICATE_DISTANCE;
}

const STATE: Record<string, ReviewState> = { sure: 'SURE', check: 'CHECK', unreadable: 'UNREADABLE' };

/** One question as stored in an AnswerKeyVersion snapshot (camelCase) -> the AI service format. */
export function toAiQuestion(q: any): AiQuestion {
  return {
    number: q.number,
    text: q.text,
    max_marks: q.maxMarks,
    answer_key: q.answerKey ?? '',
    type: (String(q.type ?? 'THEORY').toLowerCase() as AiQuestion['type']) ?? 'theory',
    final_answer: q.finalAnswer ?? null,
    alternatives: q.alternatives ?? [],
    steps: q.steps ?? [],
    rules: q.rules ?? [],
    options: q.options ?? [],
    topic: q.topic ?? null,
  };
}

type LoadedSub = NonNullable<Awaited<ReturnType<CheckingService['loadSub']>>>;

/**
 * Background checking with pg-boss (PostgreSQL queue, no Redis).
 * - two queues: "interactive" (a teacher is waiting) never waits behind "bulk" (whole-class sessions);
 * - retries with exponential backoff + jitter, heartbeats for crashed workers, a dead-letter queue that
 *   turns the copy into a visible problem for the teacher;
 * - errors are classified: rate limits/outages retry later, bad requests/keys fail fast;
 * - a shared token bucket keeps all workers under the AI provider's rate limit;
 * - a photo-quality gate runs before any AI call, so bad photos cost nothing;
 * - whole-class batches count finished copies with one UPDATE (fan-in) and send ONE "class done" alert;
 * - "overnight" tests go through the provider's half-price Batch API.
 */
@Injectable()
export class CheckingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Checking');
  private boss?: PgBoss;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly ai: AiClient,
    private readonly limiter: RateLimiterService,
  ) {}

  async onModuleInit() {
    this.boss = new PgBoss({ connectionString: env.directDatabaseUrl, schema: 'pgboss' });
    this.boss.on('error', (e) => this.log.error(e.message));
    await this.boss.start();
    const common = { policy: 'stately' as const, retryLimit: 4, retryDelay: 15, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 300, heartbeatSeconds: 30 };
    await this.ensureQueue(QUEUE_DLQ, { policy: 'standard', retryLimit: 0 });
    await this.ensureQueue(QUEUE_INTERACTIVE, { ...common, deadLetter: QUEUE_DLQ, warningQueueSize: 200 });
    await this.ensureQueue(QUEUE_BULK, { ...common, deadLetter: QUEUE_DLQ, warningQueueSize: 2000 });
    await this.ensureQueue(LEGACY_QUEUE, { ...common, deadLetter: QUEUE_DLQ });
    await this.ensureQueue(QUEUE_OVERNIGHT_SUBMIT, { policy: 'singleton', retryLimit: 2, retryDelay: 300 });
    await this.ensureQueue(QUEUE_OVERNIGHT_POLL, { policy: 'singleton', retryLimit: 1 });
    if (env.processRole === 'api') {
      this.log.log('Checking queues ready (API only: workers run in a separate process)');
      return;
    }
    const handler = (mode: CheckMode) => async (jobs: { data: { submissionId: string; now?: boolean }; retryCount?: number }[]) => {
      for (const job of jobs) await this.runJob(job.data.submissionId, mode, job.retryCount ?? 0, !!job.data.now);
    };
    const opts = { pollingIntervalSeconds: 1 };
    await this.boss.work(QUEUE_INTERACTIVE, { ...opts, localConcurrency: env.checkInteractiveConcurrency }, handler('interactive'));
    await this.boss.work(QUEUE_BULK, { ...opts, localConcurrency: env.checkBulkConcurrency }, handler('bulk'));
    await this.boss.work(LEGACY_QUEUE, { ...opts, localConcurrency: 1 }, handler('interactive'));
    await this.boss.work<{ submissionId: string }>(QUEUE_DLQ, { pollingIntervalSeconds: 5 }, async (jobs) => {
      for (const job of jobs) {
        reportError(new Error('Copy failed after all retries'), { submissionId: job.data.submissionId });
        await this.markFailed(job.data.submissionId, 'Checking failed after several tries. Tap "Check again" or re-upload the photos.');
      }
    });
    await this.boss.work(QUEUE_OVERNIGHT_SUBMIT, { pollingIntervalSeconds: 30 }, async () => void (await this.submitOvernight()));
    await this.boss.work(QUEUE_OVERNIGHT_POLL, { pollingIntervalSeconds: 30 }, async () => void (await this.pollOvernight()));
    if (!env.isTest) {
      await this.boss.schedule(QUEUE_OVERNIGHT_SUBMIT, env.overnightCron, {}, { tz: env.timezone }).catch((e: Error) => this.log.warn(`schedule: ${e.message}`));
      await this.boss.schedule(QUEUE_OVERNIGHT_POLL, '*/10 * * * *', {}, { tz: env.timezone }).catch((e: Error) => this.log.warn(`schedule: ${e.message}`));
    }
    this.log.log('Checking queues ready');
  }

  private async ensureQueue(name: string, options: Record<string, unknown>) {
    await this.boss!.createQueue(name, options as never).catch(() => undefined);
    await this.boss!.updateQueue(name, options as never).catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.boss?.stop({ graceful: true, timeout: 5000 }).catch(() => undefined);
  }

  get queue() {
    return this.boss;
  }

  /** Starts a new check run. Any older run still in flight will not be able to save its results. */
  async enqueue(submissionId: string, mode: CheckMode = 'interactive', now = false) {
    await this.prisma.submission.update({ where: { id: submissionId }, data: { status: 'PENDING', error: null, aiBatchId: null, checkRun: { increment: 1 } } });
    await this.send(submissionId, mode, undefined, now);
  }

  private async send(submissionId: string, mode: CheckMode, startAfterSeconds?: number, now = false) {
    if (!this.boss) return;
    const name = mode === 'bulk' ? QUEUE_BULK : QUEUE_INTERACTIVE;
    await this.boss.send(name, { submissionId, now }, { singletonKey: submissionId, ...(startAfterSeconds ? { startAfter: startAfterSeconds } : {}) });
  }

  /** Worker entry: errors that should be retried are re-thrown so pg-boss backs off and retries. */
  private async runJob(submissionId: string, mode: CheckMode, attempt: number, now: boolean) {
    const outcome = await this.process(submissionId, { mode, attempt, now });
    if (outcome.kind === 'later') await this.send(submissionId, mode, outcome.seconds, now);
    if (outcome.kind === 'retry') throw new Error(outcome.message);
  }

  private async loadPages(submissionId: string, prefix = false): Promise<AiPageFile[]> {
    const pages = await this.prisma.page.findMany({ where: { submissionId }, orderBy: { pageNo: 'asc' } });
    return Promise.all(
      pages.map(async (p) => ({
        pageNo: p.pageNo,
        data: await this.storage.read(p.originalPath),
        filename: prefix ? `${submissionId}__${p.pageNo}.jpg` : (p.originalPath.split('/').pop() ?? `page-${p.pageNo}.jpg`),
      })),
    );
  }

  loadSub(submissionId: string) {
    return this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        student: { select: { name: true, rollNo: true } },
        test: { include: { questions: { orderBy: { number: 'asc' } }, assignment: { include: { subject: true, section: { include: { schoolClass: true } } } } } },
      },
    });
  }

  private async payload(sub: LoadedSub): Promise<AiCheckPayload> {
    const keyRow = sub.test.keyVersion ? await this.prisma.answerKeyVersion.findUnique({ where: { testId_version: { testId: sub.testId, version: sub.test.keyVersion } } }) : null;
    return {
      submission_id: sub.id,
      subject: sub.test.assignment.subject.name,
      class_name: sub.test.assignment.section.schoolClass.name,
      language: sub.test.language,
      key_version: sub.test.keyVersion,
      questions: ((keyRow?.questions as any[] | undefined) ?? sub.test.questions).map(toAiQuestion),
      hide_identity: true,
      self_consistency: true,
      expected_pages: sub.test.expectedPages,
    };
  }

  /**
   * Runs one copy: photo gate -> (overnight? wait for the batch) -> rate limit -> AI check -> save.
   * Public so tests can call it directly. Returns what the queue should do next.
   */
  async process(
    submissionId: string,
    opts: { mode?: CheckMode; attempt?: number; now?: boolean } = {},
  ): Promise<{ kind: 'done' } | { kind: 'later'; seconds: number } | { kind: 'retry'; message: string }> {
    const sub = await this.loadSub(submissionId);
    if (!sub || sub.status === 'APPROVED') return { kind: 'done' };
    const run = sub.checkRun; // results are saved only if no newer upload/recheck happened meanwhile
    const claimed = await this.prisma.submission.updateMany({ where: { id: submissionId, checkRun: run, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } }, data: { status: 'PROCESSING', error: null } });
    if (!claimed.count) return { kind: 'done' };
    const schoolId = sub.test.assignment.subject.schoolId;

    try {
      let pages = await this.loadPages(submissionId);
      if (!pages.length) throw new AiServiceError('No pages uploaded', 400, false);

      // 1) photo gate — runs once per upload, before any AI cost
      if (!sub.qualityChecked) {
        const problems = await this.qualityGate(sub, pages, run);
        if (problems === null) return { kind: 'done' }; // a newer run took over
        if (problems.length && !sub.qualityOverride) {
          const own = await this.prisma.submission.updateMany({ where: { id: submissionId, checkRun: run, status: 'PROCESSING' }, data: { status: 'NEEDS_ATTENTION', error: problems.map((p) => p.details).join('; ').slice(0, 500) } });
          if (own.count && !sub.batchId) {
            await this.notifications.notify([sub.test.assignment.teacherId], {
              type: 'CHECKING',
              title: `Retake needed: ${sub.student.name}`,
              body: `${sub.test.title} — ${problems.map((p) => p.details).join(', ')}.`,
              data: { submissionId, testId: sub.testId, problem: 'true' },
            });
          }
          await this.afterCopyDone(sub.id, 'problems');
          return { kind: 'done' };
        }
        pages = await this.loadPages(submissionId); // corrected (straightened) pages may have replaced originals
      }

      // 2) overnight tests wait for tonight's half-price batch (unless the teacher said "check now")
      if (sub.test.gradingMode === 'OVERNIGHT' && !opts.now) {
        await this.prisma.submission.updateMany({ where: { id: submissionId, checkRun: run, status: 'PROCESSING' }, data: { status: 'PENDING', error: 'Will be checked tonight (half price)' } });
        return { kind: 'done' };
      }

      // 3) shared rate limit: wait without using up a retry
      const wait = await this.limiter.acquire();
      if (wait > 0) {
        await this.prisma.submission.updateMany({ where: { id: submissionId, checkRun: run, status: 'PROCESSING' }, data: { status: 'PENDING' } });
        if (!this.boss) return { kind: 'retry', message: 'rate limited' };
        return { kind: 'later', seconds: wait };
      }

      // 4) AI check against the confirmed answer-key version
      const result = await this.ai.check(await this.payload(sub), pages);
      await this.saveResult(sub, run, result, schoolId);
    } catch (e) {
      const err = e instanceof AiServiceError ? e : new AiServiceError((e as Error).message, 0, true);
      this.log.error(`Submission ${submissionId} failed (attempt ${(opts.attempt ?? 0) + 1}): ${err.message}`);
      if (err.retryAfter) await this.limiter.block(err.retryAfter);
      if (err.retryable && this.boss && !env.isTest) {
        // back to the queue: pg-boss retries with exponential backoff, then the dead-letter queue takes over
        await this.prisma.submission.updateMany({ where: { id: submissionId, checkRun: run }, data: { status: 'PENDING', error: `Will try again: ${err.message}`.slice(0, 500) } });
        return { kind: 'retry', message: err.message };
      }
      await this.markFailed(submissionId, err.retryable ? `Checking failed: ${err.message}` : err.message, run);
    }
    return { kind: 'done' };
  }

  /** Saves an AI result if this run still owns the copy (shared by instant and overnight checking). */
  private async saveResult(sub: LoadedSub, run: number, result: AiCheckResult, schoolId: string, purpose = 'check') {
    const submissionId = sub.id;
    const images: { pageNo: number; key: string }[] = [];
    for (const page of result.pages) {
      const key = `submissions/${submissionId}/checked-${page.page_no}-r${run}.jpg`;
      await this.storage.save(key, Buffer.from(page.annotated_image, 'base64'));
      images.push({ pageNo: page.page_no, key });
    }
    let needsReview = false;
    const answers = sub.test.questions.map((q) => {
      const a = result.answers.find((x) => x.question_number === q.number);
      const marks = a ? Math.max(0, Math.min(q.maxMarks, a.marks)) : 0;
      const state: ReviewState = a ? STATE[a.review_state] ?? 'CHECK' : 'CHECK';
      needsReview ||= state !== 'SURE';
      return {
        questionId: q.id,
        data: {
          transcription: a?.student_text ?? null,
          aiMarks: marks,
          finalMarks: marks,
          reason: a?.reason ?? 'No answer found for this question on the uploaded pages.',
          comment: a?.comment ?? '',
          aiComment: a?.comment ?? '',
          confidence: a?.confidence ?? 0,
          needsReview: state !== 'SURE',
          reviewState: state,
          isBlank: a?.is_blank ?? false,
          legibility: a?.legibility ?? null,
          ruleIds: a?.rule_ids ?? [],
          method: a?.method ?? null,
          samples: (a?.samples ?? undefined) as number[] | undefined,
          model: result.model,
          keyVersion: sub.test.keyVersion,
          pageNo: a?.page ?? null,
          region: (a?.region ?? undefined) as object | undefined,
          teacherEdited: false,
          overrideReason: null,
          reviewedAt: null,
        },
      };
    });
    const total = round1(answers.reduce((n, a) => n + (a.data.finalMarks ?? 0), 0)); // totals are added in code

    const saved = await this.prisma.$transaction(async (tx) => {
      const own = await tx.submission.updateMany({
        where: { id: submissionId, checkRun: run, status: 'PROCESSING' },
        data: { status: needsReview ? 'NEEDS_REVIEW' : 'CHECKED', obtainedMarks: total, aiSummary: result.summary, checkedAt: new Date(), keyVersion: sub.test.keyVersion, model: result.model, error: null },
      });
      if (!own.count) return false; // a newer upload or recheck took over — drop these results
      for (const a of answers) {
        await tx.answer.upsert({
          where: { submissionId_questionId: { submissionId, questionId: a.questionId } },
          update: a.data,
          create: { submissionId, questionId: a.questionId, ...a.data },
        });
      }
      for (const img of images) await tx.page.updateMany({ where: { submissionId, pageNo: img.pageNo }, data: { annotatedPath: img.key } });
      if (result.usage) {
        await tx.aiUsage.create({
          data: {
            schoolId,
            testId: sub.testId,
            submissionId,
            purpose,
            model: result.usage.model,
            calls: result.usage.calls,
            inputTokens: result.usage.input_tokens,
            cachedTokens: result.usage.cached_tokens,
            outputTokens: result.usage.output_tokens,
            costUsd: result.usage.cost_usd,
          },
        });
      }
      return true;
    });
    if (!saved) {
      this.log.log(`Submission ${submissionId}: results of run ${run} discarded (newer run exists)`);
      return;
    }
    await this.afterCopyDone(submissionId, 'done');
  }

  /**
   * Measures every page, straightens skewed pages, finds duplicates and missing pages.
   * Returns the problems found ([] = fine) or null when a newer run owns the copy.
   */
  private async qualityGate(sub: LoadedSub, pages: AiPageFile[], run: number) {
    const report: AiQuality[] = await this.ai.quality(pages);
    const problems: { type: ProblemType; pageNo: number | null; details: string }[] = [];
    // pages of other students in this test (index: pages(testId, phash)); a test has at most a few hundred
    const others = await this.prisma.page.findMany({
      where: { testId: sub.testId, submissionId: { not: sub.id }, phash: { not: null } },
      select: { phash: true, qrCode: true, submission: { select: { student: { select: { rollNo: true } } } } },
    });
    for (const q of report) {
      const page = await this.prisma.page.findUnique({ where: { submissionId_pageNo: { submissionId: sub.id, pageNo: q.page_no } } });
      if (!page) continue;
      let originalPath = page.originalPath;
      if (q.corrected_image) {
        originalPath = `submissions/${sub.id}/page-${q.page_no}-fixed-r${run}.jpg`;
        await this.storage.save(originalPath, Buffer.from(q.corrected_image, 'base64'));
      }
      await this.prisma.page.update({
        where: { id: page.id },
        data: { originalPath, phash: q.phash, blurScore: q.blur, brightness: q.brightness, width: q.width, height: q.height, qualityFlags: q.flags, testId: sub.testId },
      });
      for (const f of q.flags) {
        const p = PROBLEM_TEXT[f];
        if (p) problems.push({ type: p.type, pageNo: q.page_no, details: `${p.text} (page ${q.page_no})` });
      }
      const dup = others.find((o) => looksDuplicate({ phash: q.phash, qrCode: page.qrCode }, o));
      if (dup) problems.push({ type: 'DUPLICATE', pageNo: q.page_no, details: `Page ${q.page_no} is the same photo as roll ${dup.submission.student.rollNo}'s copy` });
    }
    // the same photo twice inside this copy (e.g. page 1 uploaded again as page 2)
    const mine = await this.prisma.page.findMany({ where: { submissionId: sub.id }, select: { pageNo: true, phash: true, qrCode: true }, orderBy: { pageNo: 'asc' } });
    for (let i = 0; i < mine.length; i++) {
      const twin = mine.slice(0, i).find((o) => looksDuplicate(mine[i], o));
      if (twin) problems.push({ type: 'DUPLICATE', pageNo: mine[i].pageNo, details: `Page ${mine[i].pageNo} is the same photo as page ${twin.pageNo} of this copy` });
    }
    if (sub.test.expectedPages && pages.length < sub.test.expectedPages) {
      problems.push({ type: 'MISSING_PAGES', pageNo: null, details: `Only ${pages.length} of ${sub.test.expectedPages} pages uploaded` });
    }
    return this.prisma.$transaction(async (tx) => {
      const own = await tx.submission.updateMany({ where: { id: sub.id, checkRun: run, status: 'PROCESSING' }, data: { qualityChecked: true } });
      if (!own.count) return null;
      await tx.problemCopy.updateMany({ where: { submissionId: sub.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
      if (problems.length) {
        await tx.problemCopy.createMany({ data: problems.map((p) => ({ ...p, schoolId: sub.test.assignment.subject.schoolId, testId: sub.testId, submissionId: sub.id })) });
      }
      return problems;
    });
  }

  /** The copy could not be checked: it becomes a visible problem for the teacher (never silently stuck). */
  async markFailed(submissionId: string, message: string, run?: number) {
    const sub = await this.prisma.submission.findUnique({ where: { id: submissionId }, include: { test: { include: { assignment: { include: { subject: true } } } }, student: { select: { name: true } } } });
    if (!sub || sub.status === 'APPROVED') return;
    const marked = await this.prisma.submission.updateMany({ where: { id: submissionId, ...(run !== undefined ? { checkRun: run } : {}), status: { not: 'APPROVED' } }, data: { status: 'FAILED', error: message.slice(0, 500) } });
    if (!marked.count) return;
    await this.prisma.problemCopy.create({ data: { schoolId: sub.test.assignment.subject.schoolId, testId: sub.testId, submissionId, type: 'CHECK_FAILED', details: message.slice(0, 300) } });
    if (!sub.batchId) {
      await this.notifications.notify([sub.test.assignment.teacherId], {
        type: 'CHECKING',
        title: `Could not check: ${sub.student.name}`,
        body: `${sub.test.title} — ${message}`.slice(0, 300),
        data: { submissionId, testId: sub.testId, problem: 'true' },
      });
    }
    await this.afterCopyDone(submissionId, 'failed');
  }

  /**
   * One copy finished. Copies in a class session are counted with ONE atomic UPDATE (fan-in, O(1));
   * exactly one worker sees the batch complete and sends the single "class done" alert.
   * Copies outside a session keep the old behaviour: one alert when the test has nothing left in the queue.
   */
  private async afterCopyDone(submissionId: string, outcome: 'done' | 'failed' | 'problems') {
    const counted = await this.prisma.$queryRaw<{ batchId: string | null; testId: string }[]>`
      UPDATE "submissions" SET "batchCounted" = true
       WHERE "id" = ${submissionId} AND "batchId" IS NOT NULL AND "batchCounted" = false
      RETURNING "batchId", "testId"`;
    if (counted[0]?.batchId) {
      const col = outcome === 'done' ? 'done' : outcome === 'failed' ? 'failed' : 'problems';
      await this.prisma.$executeRawUnsafe(`UPDATE "grading_batches" SET "${col}" = "${col}" + 1 WHERE "id" = $1`, counted[0].batchId);
      await this.maybeFinishBatch(counted[0].batchId);
      return;
    }
    const sub = await this.prisma.submission.findUnique({ where: { id: submissionId }, select: { testId: true, batchId: true } });
    if (!sub || sub.batchId) return;
    const busy = await this.prisma.submission.count({ where: { testId: sub.testId, batchId: null, status: { in: ['PENDING', 'PROCESSING'] } } });
    if (busy) return;
    const test = await this.prisma.test.findUniqueOrThrow({ where: { id: sub.testId }, include: { assignment: { include: { section: { include: { schoolClass: true } } } } } });
    const groups = await this.prisma.submission.groupBy({ by: ['status'], where: { testId: sub.testId }, _count: { _all: true } });
    const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
    const parts = [`${n('CHECKED')} ready to approve`];
    if (n('NEEDS_REVIEW')) parts.push(`${n('NEEDS_REVIEW')} need a look`);
    if (n('NEEDS_ATTENTION') + n('FAILED')) parts.push(`${n('NEEDS_ATTENTION') + n('FAILED')} need a retake or re-check`);
    await this.notifications.notify([test.assignment.teacherId], {
      type: 'CHECKING',
      title: `Checking finished: ${test.title}`,
      body: `${test.assignment.section.schoolClass.name} ${test.assignment.section.name} — ${parts.join(', ')}.`,
      data: { testId: sub.testId },
    });
  }

  /** Sends the one "class done" notification when a closed batch has every copy counted. */
  async maybeFinishBatch(batchId: string) {
    const done = await this.prisma.$queryRaw<{ id: string; testId: string; createdById: string; total: number; done: number; failed: number; problems: number }[]>`
      UPDATE "grading_batches" SET "status" = 'DONE', "notifiedAt" = now()
       WHERE "id" = ${batchId} AND "status" = 'CLOSED' AND "done" + "failed" + "problems" >= "total"
      RETURNING "id", "testId", "createdById", "total", "done", "failed", "problems"`;
    const b = done[0];
    if (!b) return false;
    const test = await this.prisma.test.findUniqueOrThrow({ where: { id: b.testId }, include: { assignment: { include: { subject: true, section: { include: { schoolClass: true } } } } } });
    const review = await this.prisma.submission.count({ where: { batchId, status: 'NEEDS_REVIEW' } });
    const attention = b.failed + b.problems;
    await this.notifications.notify([b.createdById], {
      type: 'CHECKING',
      title: `${test.assignment.section.schoolClass.name} ${test.assignment.section.name} ${test.assignment.subject.name}: ${b.done} checked${attention ? `, ${attention} need attention` : ''}`,
      body: `${test.title} — ${b.done - review} ready to approve${review ? `, ${review} with answers to look at` : ''}${attention ? `, ${attention} need a retake or a second try` : ''}.`,
      data: { testId: b.testId, batchId },
    });
    return true;
  }

  // ---------- overnight (Batch API) ----------

  /** Collects tonight's copies and sends them as provider batches (max 200 copies each). */
  async submitOvernight() {
    const subs = await this.prisma.submission.findMany({
      where: { status: 'PENDING', qualityChecked: true, aiBatchId: null, test: { gradingMode: 'OVERNIGHT' } },
      take: 2000,
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    let sent = 0;
    for (let i = 0; i < subs.length; i += 200) {
      const chunk = subs.slice(i, i + 200);
      const items: { custom_id: string; request: AiCheckPayload }[] = [];
      const pages: AiPageFile[] = [];
      const runs: Record<string, number> = {};
      for (const { id } of chunk) {
        const sub = await this.loadSub(id);
        if (!sub) continue;
        items.push({ custom_id: id, request: await this.payload(sub) });
        pages.push(...(await this.loadPages(id, true)));
        runs[id] = sub.checkRun;
      }
      if (!items.length) continue;
      const res = await this.ai.batchSubmit(items, pages);
      const batch = await this.prisma.aiBatch.create({ data: { provider: res.provider, providerBatchId: res.batch_id, submissionIds: Object.keys(runs), runs } });
      for (const [id, run] of Object.entries(runs)) {
        await this.prisma.submission.updateMany({ where: { id, checkRun: run, status: 'PENDING' }, data: { status: 'PROCESSING', aiBatchId: batch.id, error: 'Being checked overnight' } });
      }
      sent += items.length;
    }
    if (sent) this.log.log(`Overnight: ${sent} copies sent to the Batch API`);
    return sent;
  }

  /** Checks running provider batches; saves finished ones with the same rules as instant checking. */
  async pollOvernight() {
    const open = await this.prisma.aiBatch.findMany({ where: { status: { in: ['submitted', 'validating', 'in_progress', 'finalizing'] } } });
    let saved = 0;
    for (const b of open) {
      const st = await this.ai.batchStatus(b.providerBatchId).catch(() => null);
      if (!st) continue;
      if (['failed', 'expired', 'cancelled'].includes(st.status)) {
        await this.prisma.aiBatch.update({ where: { id: b.id }, data: { status: st.status, error: `provider batch ${st.status}` } });
        // fall back to normal checking so nothing is lost
        for (const id of b.submissionIds) await this.enqueue(id, 'bulk', true).catch(() => undefined);
        continue;
      }
      if (st.status !== 'completed') {
        if (st.status !== b.status) await this.prisma.aiBatch.update({ where: { id: b.id }, data: { status: st.status } });
        continue;
      }
      const res = await this.ai.batchResults(b.providerBatchId);
      const runs = b.runs as Record<string, number>;
      for (const id of b.submissionIds) {
        const sub = await this.loadSub(id);
        if (!sub || sub.checkRun !== runs[id] || sub.aiBatchId !== b.id) continue;
        const r = res.results[id];
        if (!r) {
          await this.enqueue(id, 'bulk', true).catch(() => undefined); // this copy failed in the batch: check it normally
          continue;
        }
        try {
          const final = await this.ai.finalize({ request: await this.payload(sub), raw: r.raw, usage: r.usage }, await this.loadPages(id));
          await this.saveResult(sub, sub.checkRun, final, sub.test.assignment.subject.schoolId, 'check-overnight');
          saved++;
        } catch (e) {
          await this.markFailed(id, `Overnight check failed: ${(e as Error).message}`, sub.checkRun);
        }
      }
      await this.prisma.aiBatch.update({ where: { id: b.id }, data: { status: 'completed', completedAt: new Date() } });
    }
    return saved;
  }

  /** Redraws the red-pen copy after the teacher changes marks. Never blocks approval. */
  async reannotate(submissionId: string) {
    try {
      const sub = await this.prisma.submission.findUniqueOrThrow({
        where: { id: submissionId },
        include: { answers: { include: { question: true } }, test: true },
      });
      const pages = await this.loadPages(submissionId);
      const result = await this.ai.annotate(
        {
          answers: sub.answers.map((a) => ({
            question_number: a.question.number,
            marks: a.finalMarks ?? 0,
            max_marks: a.question.maxMarks,
            comment: a.comment ?? '',
            page: a.pageNo,
            region: (a.region as { y0: number; y1: number } | null) ?? null,
          })),
          total: sub.obtainedMarks ?? 0,
          max_total: sub.test.totalMarks,
        },
        pages,
      );
      for (const page of result.pages) {
        const key = `submissions/${submissionId}/checked-${page.page_no}-final.jpg`;
        await this.storage.save(key, Buffer.from(page.annotated_image, 'base64'));
        await this.prisma.page.updateMany({ where: { submissionId, pageNo: page.page_no }, data: { annotatedPath: key } });
      }
    } catch (e) {
      this.log.warn(`Re-annotation skipped for ${submissionId}: ${(e as Error).message}`);
    }
  }
}

export function hammingHex(a: string, b: string) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export const sha256Buffer = (b: Buffer) => createHash('sha256').update(b).digest('hex');
