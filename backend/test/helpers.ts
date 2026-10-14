import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export async function bootApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(mod.createNestApplication());
  await app.init();
  return { app, mail: app.get(MailService), prisma: app.get(PrismaService) };
}

export const api = (app: INestApplication) => request(app.getHttpServer());

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export type FakeAi = Server & {
  calls: string[];
  /** flags returned by /v1/quality for every page, e.g. ['blurry'] */
  qualityFlags: string[];
  /** phash returned for each page (same hash = duplicate photo) */
  phash: (n: number) => string;
  /** respond to the next /v1/check with this error */
  failNext: { status: number; body: object; headers?: Record<string, string> } | null;
  /** review_state of the last question (default 'check') */
  lastState: 'sure' | 'check' | 'unreadable';
  /** overnight batches: id -> submission ids */
  batches: Map<string, string[]>;
  /** /v1/scan answer per uploaded file name (the fake cannot read real QR codes) */
  scans: Record<string, { qr?: string; omr?: { question: number; choice: string | null; status: 'ok' | 'blank' | 'multiple' }[] | null }>;
};

/** A fake AI service, so backend tests are fast and need no Python or OpenAI key. */
export function startFakeAi(port = 18765): Promise<FakeAi> {
  let counter = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      server.calls.push(req.url!);
      if (req.headers['x-service-token'] !== 'test-ai-token') {
        res.writeHead(401).end('{}');
        return;
      }
      const body = Buffer.concat(chunks).toString('latin1');
      const m = body.match(/name="payload"\r\n\r\n([\s\S]*?)\r\n--/);
      const payload = m ? JSON.parse(Buffer.from(m[1], 'latin1').toString('utf8')) : {};
      const pageCount = (body.match(/name="pages"/g) ?? []).length || 1;
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/annotate') {
        res.end(JSON.stringify({ pages: [{ page_no: 1, annotated_image: PNG }] }));
        return;
      }
      if (req.url === '/v1/quality') {
        const flags = server.qualityFlags;
        res.end(JSON.stringify(Array.from({ length: pageCount }, (_, i) => ({
          page_no: i + 1, width: 1240, height: 1754, blur: 300, edge_density: 0.04, brightness: 230, glare: 0, ink_ratio: 0.02,
          phash: server.phash(++counter), flags, ok: !flags.some((f) => ['blurry', 'dark', 'glare', 'cut_off', 'low_resolution'].includes(f)), corrected_image: null,
        }))));
        return;
      }
      if (req.url === '/v1/answer-key/parse') {
        const qs = (payload.questions ?? []).map((q: any) => ({
          ...q,
          type: /^[A-D]$/.test(q.answer_key) ? 'mcq' : /^[\d.]+/.test(q.answer_key) ? 'numeric' : 'theory',
          final_answer: /^[A-D]$/.test(q.answer_key) || /^[\d.]+/.test(q.answer_key) ? q.answer_key : null,
          alternatives: [], steps: [], rules: [{ id: 'R1', text: 'any correct wording' }], options: [], topic: null,
        }));
        res.end(JSON.stringify({ questions: qs, model: 'fake', usage: { model: 'fake', calls: 1, input_tokens: 500, cached_tokens: 0, output_tokens: 200, cost_usd: 0.0005 }, notes: [] }));
        return;
      }
      if (req.url === '/v1/scan') {
        const names = [...body.matchAll(/name="pages"; filename="([^"]+)"/g)].map((m) => m[1]);
        res.end(JSON.stringify(names.map((name, index) => {
          const s = server.scans[name] ?? {};
          const parts = s.qr?.split('.') ?? [];
          const kind = parts[4];
          const qr = s.qr ? { text: s.qr, test_id: parts[1], student_id: parts[2], page: Number(parts[3]), kind: kind === 'c' ? 'copy' : 'omr' } : null;
          return { index, filename: name, qr, qr_y: qr ? 0.05 : null, omr: s.omr === undefined ? null : s.omr ? { answers: s.omr.map((a) => ({ ...a, fills: [] })) } : null };
        })));
        return;
      }
      // overnight Batch API: "completes" at once
      if (req.url === '/v1/batch/submit') {
        const id = `fake-batch-${server.batches.size + 1}`;
        server.batches.set(id, payload.map((i: any) => i.custom_id));
        res.end(JSON.stringify({ batch_id: id, provider: 'fake', count: payload.length }));
        return;
      }
      const bm = req.url?.match(/^\/v1\/batch\/([^/]+)(\/results)?$/);
      if (bm) {
        const ids = server.batches.get(bm[1]) ?? [];
        if (!bm[2]) {
          res.end(JSON.stringify({ status: 'completed', total: ids.length, completed: ids.length, failed: 0 }));
          return;
        }
        res.end(JSON.stringify({ results: Object.fromEntries(ids.map((id) => [id, { raw: { summary: 'overnight', answers: [] }, usage: { model: 'fake-batch', calls: 1, input_tokens: 3000, cached_tokens: 0, output_tokens: 600, cost_usd: 0.0006 } }])), errors: {} }));
        return;
      }
      if (req.url === '/v1/finalize') {
        const qs = payload.request.questions;
        const answers = qs.map((q: any) => ({
          question_number: q.number, student_text: 'overnight', is_blank: false, legibility: 'ok', rule_ids: [], marks: q.max_marks, max_marks: q.max_marks,
          reason: 'Correct', comment: '', confidence: 0.95, review_state: 'sure', needs_review: false, page: 1, region: null, method: 'llm', samples: null,
        }));
        res.end(JSON.stringify({ answers, pages: [{ page_no: 1, annotated_image: PNG }], summary: 'overnight', model: 'fake-batch', total: answers.reduce((x: number, a: any) => x + a.marks, 0), max_total: 0, usage: payload.usage, quality: [] }));
        return;
      }
      if (server.failNext) {
        const f = server.failNext;
        server.failNext = null;
        res.writeHead(f.status, f.headers ?? {}).end(JSON.stringify(f.body));
        return;
      }
      const n = payload.questions.length;
      const answers = payload.questions.map((q: any, i: number) => {
        const last = i === n - 1;
        const state = last ? server.lastState : 'sure';
        return {
          question_number: q.number,
          student_text: `answer ${q.number}`,
          is_blank: false,
          legibility: state === 'unreadable' ? 'unreadable' : 'ok',
          rule_ids: q.rules?.length ? [q.rules[0].id] : [],
          marks: i === 0 ? q.max_marks : q.max_marks / 2,
          max_marks: q.max_marks,
          reason: i === 0 ? 'Correct' : 'Half correct',
          comment: i === 0 ? '' : 'Show the formula',
          confidence: last ? 0.5 : 0.9,
          review_state: state,
          needs_review: state !== 'sure',
          page: 1,
          region: { y0: 0.1 + i * 0.2, y1: 0.15 + i * 0.2 },
          method: 'llm',
          samples: null,
        };
      });
      const total = answers.reduce((x: number, a: any) => x + a.marks, 0);
      res.end(JSON.stringify({
        answers, pages: [{ page_no: 1, annotated_image: PNG }], summary: 'Good effort.', model: 'fake', total, max_total: 0,
        usage: { model: 'fake', calls: 1, input_tokens: 3000, cached_tokens: 2048, output_tokens: 600, cost_usd: 0.0013 }, quality: [],
      }));
    });
  }) as FakeAi;
  server.calls = [];
  server.qualityFlags = [];
  server.phash = (n) => BigInt.asUintN(64, BigInt(n) * 0x9e3779b97f4a7c15n).toString(16).padStart(16, '0');
  server.failNext = null;
  server.lastState = 'check';
  server.batches = new Map();
  server.scans = {};
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250));
    v = await fn();
  }
  return v;
}

/** Smallest valid JPEG-ish payload; the fake AI never decodes it. */
export const photo = Buffer.from(PNG, 'base64');
