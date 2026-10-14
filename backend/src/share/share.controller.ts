import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../common/decorators.js';
import { ShareService } from './share.service.js';

@ApiTags('share')
@Controller('share')
export class ShareController {
  constructor(private readonly svc: ShareService) {}

  /** A WhatsApp-ready text + signed link to one published result. */
  @ApiBearerAuth()
  @Post('results/:id')
  create(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.create(u, id);
  }

  @Public() @ApiExcludeEndpoint() @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('r/:token')
  async page(@Param('token') token: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.type('html').send(await this.svc.page(token));
  }
}
