import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators.js';
import { ClaimsService } from './claims.service.js';
import { ApproveClaimDto, ClaimDto, RejectDto, ResubmitDto, UseCodeDto } from './claims.dto.js';

@ApiTags('claims')
@Controller()
export class ClaimsController {
  constructor(private readonly svc: ClaimsService) {}

  /** School code or class (section) code → school, classes and sections. */
  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('auth/schools/:code')
  school(@Param('code') code: string) {
    return this.svc.lookup(code);
  }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/claim')
  claim(@Body() dto: ClaimDto) {
    return this.svc.claim({ ...dto, code: dto.code ?? dto.joinCode });
  }

  /** Older apps call this name. */
  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/register-student')
  register(@Body() dto: ClaimDto) {
    return this.svc.claim({ ...dto, code: dto.code ?? dto.joinCode });
  }

  @ApiBearerAuth() @Roles('STUDENT')
  @Get('student/enrollment')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.myStatus(u.id);
  }

  @ApiBearerAuth() @Roles('STUDENT') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Patch('student/enrollment')
  resubmit(@CurrentUser() u: AuthUser, @Body() dto: ResubmitDto) {
    return this.svc.resubmit(u.id, dto);
  }

  @ApiBearerAuth() @Roles('STUDENT') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('student/claim-code')
  useCode(@CurrentUser() u: AuthUser, @Body() dto: UseCodeDto) {
    return this.svc.useCode(u.id, dto.code);
  }

  @ApiBearerAuth() @Roles('TEACHER', 'ADMIN')
  @Get('requests')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u);
  }

  @ApiBearerAuth() @Roles('TEACHER', 'ADMIN')
  @Get('requests/count')
  async count(@CurrentUser() u: AuthUser) {
    return { count: await this.svc.count(u) };
  }

  @ApiBearerAuth() @Roles('TEACHER', 'ADMIN') @HttpCode(200)
  @Post('requests/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ApproveClaimDto) {
    return this.svc.approve(u, id, dto.studentId);
  }

  @ApiBearerAuth() @Roles('TEACHER', 'ADMIN') @HttpCode(200)
  @Post('requests/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.svc.reject(u, id, dto.reason);
  }
}
