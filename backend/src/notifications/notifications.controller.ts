import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from '../common/decorators.js';
import { NotificationsService } from './notifications.service.js';

class PushTokenDto {
  @IsString() token: string;
  @IsOptional() @IsString() platform?: string;
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('cursor') cursor?: string) {
    return this.svc.list(u.id, 30, cursor);
  }

  @Get('unread-count')
  async unread(@CurrentUser() u: AuthUser) {
    return { count: await this.svc.unreadCount(u.id) };
  }

  @Post('read-all')
  async readAll(@CurrentUser() u: AuthUser) {
    await this.svc.markAllRead(u.id);
    return { ok: true };
  }

  @Post(':id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.svc.markRead(u.id, id);
    return { ok: true };
  }

  @Delete('push-token')
  async removePush(@CurrentUser() u: AuthUser, @Body() dto: PushTokenDto) {
    await this.svc.removePushToken(u.id, dto.token);
    return { ok: true };
  }

  @Post('push-token')
  async push(@CurrentUser() u: AuthUser, @Body() dto: PushTokenDto) {
    await this.svc.registerPushToken(u.id, dto.token, dto.platform);
    return { ok: true };
  }
}
