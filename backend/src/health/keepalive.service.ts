import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { env } from '../config/env.js';

/**
 * Free hosts (Render free) stop the API after 15 minutes without requests; the next visitor then waits
 * about a minute. With KEEPALIVE_URL set, the API calls its own public address every KEEPALIVE_MINUTES,
 * but only inside KEEPALIVE_HOURS (school hours, TZ_SCHEDULE time), so the free monthly hours last.
 * Outside those hours it is allowed to sleep; the first visitor (or the morning GitHub Action) wakes it.
 */
@Injectable()
export class KeepAliveService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('KeepAlive');
  private timer?: NodeJS.Timeout;

  onApplicationBootstrap() {
    if (!env.keepAliveUrl || env.isTest) return;
    const window = parseHours(env.keepAliveHours);
    this.timer = setInterval(() => void this.tick(window), env.keepAliveMinutes * 60_000);
    this.timer.unref?.();
    this.log.log(`Keep-alive every ${env.keepAliveMinutes} min${window ? ` between ${window[0]}:00 and ${window[1]}:00 (${env.timezone})` : ' (all day)'}`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(window: [number, number] | null) {
    if (window && !inWindow(hourIn(env.timezone), window)) return;
    try {
      await fetch(env.keepAliveUrl, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'laalpen-keepalive' } });
    } catch {
      /* a missed ping only means the API may sleep once */
    }
  }
}

/** "9-21" -> [9, 21]; empty or invalid -> null (all day). */
export function parseHours(v: string): [number, number] | null {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(v ?? '');
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return a >= 0 && a <= 24 && b >= 0 && b <= 24 && a !== b ? [a, b] : null;
}

/** [9, 21] covers 9:00-20:59; [22, 6] wraps past midnight. */
export function inWindow(hour: number, [a, b]: [number, number]) {
  return a < b ? hour >= a && hour < b : hour >= a || hour < b;
}

export function hourIn(timeZone: string, d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(d));
}
