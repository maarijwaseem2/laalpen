import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { env } from '../config/env.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness only (no database, no AI call): for wake-up pings and keep-alive, so they don't also wake the database and the AI service. */
  @Public()
  @SkipThrottle()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    let ai = 'down';
    try {
      const r = await fetch(`${env.aiServiceUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) ai = ((await r.json()) as { mode?: string }).mode ?? 'up';
    } catch {
      /* AI service not running */
    }
    return {
      status: 'ok',
      database: 'up',
      aiService: ai,
      email: env.brevoApiKey ? 'brevo' : 'console',
      googleLogin: env.firebaseProjectId ? 'enabled' : 'not configured',
    };
  }
}
