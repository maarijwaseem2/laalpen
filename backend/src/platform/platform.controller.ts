import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators.js';
import { PlatformService } from './platform.service.js';
import { AddPrincipalDto, CreateSchoolDto, SuspendDto } from './platform.dto.js';

/** LaalPen super admin only: schools, their principals, pausing a school or an account. */
@ApiTags('platform')
@ApiBearerAuth()
@Roles('SUPER_ADMIN')
@Controller('platform')
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Get('overview') overview() { return this.svc.overview(); }
  @Get('schools') schools(@Query('search') search?: string) { return this.svc.schools(search); }
  @Get('schools/:id') school(@Param('id') id: string) { return this.svc.school(id); }
  @Post('schools') create(@CurrentUser() u: AuthUser, @Body() dto: CreateSchoolDto) { return this.svc.createSchool(u, dto); }
  @Post('schools/:id/principals') addPrincipal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AddPrincipalDto) { return this.svc.addPrincipal(u, id, dto); }
  @HttpCode(200) @Post('schools/:id/suspend') suspend(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SuspendDto) { return this.svc.setSchoolSuspended(u, id, true, dto.reason); }
  @HttpCode(200) @Post('schools/:id/restore') restore(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.setSchoolSuspended(u, id, false); }
  @HttpCode(200) @Post('users/:id/suspend') suspendUser(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.setUserActive(u, id, false); }
  @HttpCode(200) @Post('users/:id/restore') restoreUser(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.setUserActive(u, id, true); }
  @HttpCode(200) @Post('principals/:id/resend-invite') resend(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.resendInvite(u, id); }
}
