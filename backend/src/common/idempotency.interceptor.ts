import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, Observable, tap } from 'rxjs';

type Outcome = { ok: true; body: unknown } | { ok: false; error: unknown };
type Entry = { at: number; promise: Promise<Outcome> };

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** how long a finished request is remembered (retries after a dropped connection arrive well within this) */
export const IDEMPOTENCY_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 10_000;

/**
 * Duplicate-request protection (double click, flaky network retry). A write request that carries an
 * `Idempotency-Key` header runs once per user + method + path + key:
 * - a copy that arrives while the first is still running waits for it and gets the same answer
 * - a copy that arrives later gets the stored answer (header `Idempotent-Replay: true`)
 * - a failed request is forgotten, so the user can simply try again
 * Requests without the header behave as before.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly seen = new Map<string, Entry>();

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<{ method: string; originalUrl?: string; url: string; headers: Record<string, unknown>; user?: { id: string }; ip?: string; ips?: string[] }>();
    const res = ctx.switchToHttp().getResponse<{ setHeader: (k: string, v: string) => void }>();
    if (!WRITE.has(req.method)) return next.handle();
    const raw = req.headers['idempotency-key'];
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) return next.handle();
    if (key.length > 128 || !/^[\w.:-]+$/.test(key)) throw new BadRequestException('Idempotency-Key must be up to 128 letters, digits, "-", "_", "." or ":"');

    const who = req.user?.id ?? `ip:${req.ips?.[0] ?? req.ip ?? ''}`;
    const id = `${who}|${req.method}|${(req.originalUrl ?? req.url).split('?')[0]}|${key}`;
    this.sweep();
    const prior = this.seen.get(id);
    if (prior) {
      res.setHeader('Idempotent-Replay', 'true');
      return from(
        prior.promise.then((o) => {
          if (o.ok) return o.body;
          throw o.error;
        }),
      );
    }
    let settle!: (o: Outcome) => void;
    const promise = new Promise<Outcome>((r) => (settle = r));
    this.seen.set(id, { at: Date.now(), promise });
    return next.handle().pipe(
      tap({
        next: (body) => settle({ ok: true, body }),
        error: (error) => {
          this.seen.delete(id);
          settle({ ok: false, error });
        },
      }),
    );
  }

  private sweep() {
    const now = Date.now();
    for (const [k, e] of this.seen) {
      if (now - e.at < IDEMPOTENCY_TTL_MS && this.seen.size <= MAX_ENTRIES) break; // oldest first (Map keeps insertion order)
      this.seen.delete(k);
    }
  }
}
