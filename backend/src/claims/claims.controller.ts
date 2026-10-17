import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators.js';
import { ClaimsService } from './claims.service.js';
import { ApproveClaimDto, FamilyLinkDto, RejectDto, ResubmitDto, UseCodeDto } from './claims.dto.js';

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

  /** Student self sign-up moved: everyone creates one Parent / Student account (POST /auth/signup), then links the child. */
  @Public() @HttpCode(403) @ApiExcludeEndpoint()
  @Post(['auth/claim', 'auth/register-student'])
  claimMoved() {
    throw new ForbiddenException({ message: 'Create a Parent / Student account first, then add your child with the class or card code.', code: 'SIGNUP_MOVED' });
  }

  /** Family account: which kind of code is this (class / school / card)? */
  @ApiBearerAuth() @Roles('PARENT') @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('parent/code/:code')
  detect(@Param('code') code: string) {
    return this.svc.detectCode(code);
  }

  /** Family account: link a child with one code (card = at once; class/school code + name + roll = checked, maybe teacher approval). */
  @ApiBearerAuth() @Roles('PARENT') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('parent/link')
  link(@CurrentUser() u: AuthUser, @Body() dto: FamilyLinkDto) {
    return this.svc.familyLink(u.id, dto);
  }

  @ApiBearerAuth() @Roles('PARENT')
  @Get('parent/requests')
  requests(@CurrentUser() u: AuthUser) {
    return this.svc.familyRequests(u.id);
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

  @ApiBearerAuth() @Roles('TEACHER', 'PRINCIPAL')
  @Get('requests')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u);
  }

  @ApiBearerAuth() @Roles('TEACHER', 'PRINCIPAL')
  @Get('requests/count')
  async count(@CurrentUser() u: AuthUser) {
    return { count: await this.svc.count(u) };
  }

  @ApiBearerAuth() @Roles('TEACHER', 'PRINCIPAL') @HttpCode(200)
  @Post('requests/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ApproveClaimDto) {
    return this.svc.approve(u, id, dto.studentId);
  }

  @ApiBearerAuth() @Roles('TEACHER', 'PRINCIPAL') @HttpCode(200)
  @Post('requests/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.svc.reject(u, id, dto.reason);
  }
}
