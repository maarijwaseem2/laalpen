import { Injectable } from '@nestjs/common';
import { env } from '../config/env.js';

export type AiQuestionType = 'theory' | 'numeric' | 'mcq';

export interface AiQuestion {
  number: number;
  text: string;
  max_marks: number;
  answer_key: string;
  type?: AiQuestionType;
  final_answer?: string | null;
  alternatives?: string[];
  steps?: { marks: number; description: string }[];
  rules?: { id: string; text: string }[];
  options?: string[];
  topic?: string | null;
}

export interface AiAnswer {
  question_number: number;
  student_text: string | null;
  is_blank: boolean;
  legibility: 'ok' | 'poor' | 'unreadable';
  rule_ids: string[];
  marks: number;
  max_marks: number;
  reason: string;
  comment: string;
  confidence: number;
  review_state: 'sure' | 'check' | 'unreadable';
  needs_review: boolean;
  page: number | null;
  region: { y0: number; y1: number } | null;
  method: string;
  samples: number[] | null;
}

export interface AiUsageInfo {
  model: string;
  calls: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface AiQuality {
  page_no: number;
  width: number;
  height: number;
  blur: number;
  edge_density: number;
  brightness: number;
  glare: number;
  ink_ratio: number;
  phash: string;
  flags: string[];
  ok: boolean;
  corrected_image: string | null;
}

export interface AiCheckResult {
  answers: AiAnswer[];
  pages: { page_no: number; annotated_image: string }[];
  summary: string;
  model: string;
  total: number;
  max_total: number;
  usage: AiUsageInfo | null;
  quality: AiQuality[];
}

export interface AiScanResult {
  index: number;
  filename: string;
  qr: { text: string; test_id: string; student_id: string; page: number; kind: 'copy' | 'omr'; questions?: number; options?: number } | null;
  qr_y: number | null;
  omr: { answers: { question: number; choice: string | null; status: 'ok' | 'blank' | 'multiple'; fills: number[] }[] } | null;
  error?: string;
}

export interface AiCheckPayload {
  submission_id: string;
  subject: string;
  class_name: string;
  language: string;
  key_version: number;
  questions: AiQuestion[];
  hide_identity?: boolean;
  self_consistency?: boolean;
  expected_pages?: number | null;
  model?: string | null;
}

export interface AiPageFile {
  pageNo: number;
  data: Buffer;
  filename: string;
}

/** Error from the AI service. `retryable` = rate limit / outage (try later), otherwise a permanent problem. */
export class AiServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

/** Talks to the FastAPI AI service. Only R2/disk keys and image bytes travel here, never user data beyond the copy. */
@Injectable()
export class AiClient {
  private async post<T>(path: string, fields: Record<string, string>, files: AiPageFile[], fileField = 'pages'): Promise<T> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    for (const p of files) {
      const type = p.filename.endsWith('.png') ? 'image/png' : p.filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      form.append(fileField, new Blob([new Uint8Array(p.data)], { type }), p.filename);
    }
    let res: Response;
    try {
      res = await fetch(`${env.aiServiceUrl}${path}`, {
        method: 'POST',
        headers: { 'x-service-token': env.aiServiceToken },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new AiServiceError(`AI service unreachable: ${(e as Error).message}`, 0, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let body: { detail?: unknown; retryable?: boolean; retry_after?: number | null } = {};
      try {
        body = JSON.parse(text);
      } catch {
        /* plain text error */
      }
      const retryable = body.retryable ?? (res.status === 429 || res.status >= 503 || res.status === 500);
      const retryAfter = body.retry_after ?? (Number(res.headers.get('retry-after')) || null);
      const detail = typeof body.detail === 'string' ? body.detail : text.slice(0, 300);
      throw new AiServiceError(`AI service ${res.status}: ${detail}`, res.status, retryable, retryAfter);
    }
    return (await res.json()) as T;
  }

  check(payload: AiCheckPayload, pages: AiPageFile[]): Promise<AiCheckResult> {
    return this.post<AiCheckResult>('/v1/check', { payload: JSON.stringify(payload) }, pages);
  }

  quality(pages: AiPageFile[], straighten = true): Promise<AiQuality[]> {
    return this.post<AiQuality[]>('/v1/quality', { straighten_pages: String(straighten) }, pages);
  }

  parseKey(
    payload: { subject: string; class_name: string; text: string; questions: AiQuestion[] },
    images: AiPageFile[],
  ): Promise<{ questions: AiQuestion[]; model: string; usage: AiUsageInfo | null; notes: string[] }> {
    return this.post('/v1/answer-key/parse', { payload: JSON.stringify(payload) }, images, 'images');
  }

  /** Overnight: send many copies as one provider batch (half price). pages: filename "<submissionId>__<page>.jpg". */
  batchSubmit(items: { custom_id: string; request: AiCheckPayload }[], pages: AiPageFile[]): Promise<{ batch_id: string; provider: string; count: number }> {
    return this.post('/v1/batch/submit', { payload: JSON.stringify(items) }, pages);
  }

  async batchStatus(id: string): Promise<{ status: string; total: number; completed: number; failed: number }> {
    const res = await fetch(`${env.aiServiceUrl}/v1/batch/${encodeURIComponent(id)}`, { headers: { 'x-service-token': env.aiServiceToken }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new AiServiceError(`AI service ${res.status}`, res.status, res.status >= 500);
    return (await res.json()) as never;
  }

  batchResults(id: string): Promise<{ results: Record<string, { raw: unknown; usage: AiUsageInfo }>; errors: Record<string, string> }> {
    return this.post(`/v1/batch/${encodeURIComponent(id)}/results`, {}, []);
  }

  /** Raw model output -> safety rules + totals + red pen (no AI call). */
  finalize(payload: { request: AiCheckPayload; raw: unknown; usage: AiUsageInfo }, pages: AiPageFile[]): Promise<AiCheckResult> {
    return this.post<AiCheckResult>('/v1/finalize', { payload: JSON.stringify(payload) }, pages);
  }

  /** QR codes (whose page is this?) and OMR bubbles for a pile of photos — no AI model, no cost. */
  scan(pages: AiPageFile[]): Promise<AiScanResult[]> {
    return this.post<AiScanResult[]>('/v1/scan', {}, pages);
  }

  annotate(
    payload: { answers: Pick<AiAnswer, 'question_number' | 'marks' | 'max_marks' | 'comment' | 'page' | 'region'>[]; total: number; max_total: number },
    pages: AiPageFile[],
  ): Promise<{ pages: { page_no: number; annotated_image: string }[] }> {
    return this.post('/v1/annotate', { payload: JSON.stringify(payload) }, pages);
  }
}
