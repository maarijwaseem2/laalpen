import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { env } from '../config/env.js';

/**
 * One token bucket in PostgreSQL shared by every worker process, so all workers together stay under the
 * AI provider's requests-per-minute limit. A 429 with Retry-After blocks the bucket for everyone.
 * Each acquire is a single UPDATE ... RETURNING on a primary key: O(1), no locks held between calls.
 */
@Injectable()
export class RateLimiterService {
  constructor(private readonly prisma: PrismaService) {}

  private get rpm() {
    return Math.max(1, env.aiRequestsPerMinute);
  }

  /** Returns 0 when a token was taken, otherwise the seconds to wait before trying again. */
  async acquire(name = 'ai', cost = 1): Promise<number> {
    const capacity = Math.max(cost, Math.ceil(this.rpm / 4));
    const refill = this.rpm / 60;
    await this.prisma.$executeRaw`
      INSERT INTO "rate_buckets" ("name", "tokens", "capacity", "refillPerSec", "updatedAt")
      VALUES (${name}, ${capacity}, ${capacity}, ${refill}, now())
      ON CONFLICT ("name") DO UPDATE SET "capacity" = EXCLUDED."capacity", "refillPerSec" = EXCLUDED."refillPerSec"
      WHERE "rate_buckets"."capacity" <> EXCLUDED."capacity" OR "rate_buckets"."refillPerSec" <> EXCLUDED."refillPerSec"`;
    const taken = await this.prisma.$queryRaw<{ tokens: number }[]>`
      UPDATE "rate_buckets"
         SET "tokens" = LEAST("capacity", "tokens" + EXTRACT(EPOCH FROM (now() - "updatedAt")) * "refillPerSec") - ${cost},
             "updatedAt" = now()
       WHERE "name" = ${name}
         AND ("blockedUntil" IS NULL OR "blockedUntil" <= now())
         AND LEAST("capacity", "tokens" + EXTRACT(EPOCH FROM (now() - "updatedAt")) * "refillPerSec") >= ${cost}
      RETURNING "tokens"`;
    if (taken.length) return 0;
    const [row] = await this.prisma.$queryRaw<{ wait: number }[]>`
      SELECT GREATEST(
               COALESCE(EXTRACT(EPOCH FROM ("blockedUntil" - now())), 0),
               (${cost} - LEAST("capacity", "tokens" + EXTRACT(EPOCH FROM (now() - "updatedAt")) * "refillPerSec")) / NULLIF("refillPerSec", 0)
             )::float AS wait
        FROM "rate_buckets" WHERE "name" = ${name}`;
    return Math.max(1, Math.ceil(row?.wait ?? 1));
  }

  /** Provider said "slow down": nobody calls it again before `seconds` have passed. */
  async block(seconds: number, name = 'ai') {
    await this.prisma.$executeRaw`
      UPDATE "rate_buckets" SET "blockedUntil" = GREATEST(COALESCE("blockedUntil", now()), now() + make_interval(secs => ${seconds}))
       WHERE "name" = ${name}`;
  }
}
