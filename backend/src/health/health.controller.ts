import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { env } from '../config/env.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
