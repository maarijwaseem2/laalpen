import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AllowSetup, CurrentUser, Roles, type AuthUser } from '../common/decorators.js';
import { SchoolService } from './school.service.js';
import { RejectTeacherDto, SchoolProfileDto, TeacherProfileDto } from './school.dto.js';

/** Principal: the school profile (first sign-in) and approving teachers. */
@ApiTags('school')
@ApiBearerAuth()
@Roles('PRINCIPAL')
@Controller()
export class SchoolController {
  constructor(private readonly svc: SchoolService) {}

  @AllowSetup() @Get('school/profile') get(@CurrentUser() u: AuthUser) { return this.svc.getSchoolProfile(u); }
  @AllowSetup() @Put('school/profile') save(@CurrentUser() u: AuthUser, @Body() dto: SchoolProfileDto) { return this.svc.saveSchoolProfile(u, dto); }

  @Get('admin/teachers/pending') pending(@CurrentUser() u: AuthUser) { return this.svc.pendingTeachers(u); }
  @HttpCode(200) @Post('admin/teachers/:id/approve') approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approveTeacher(u, id); }
  @HttpCode(200) @Post('admin/teachers/:id/reject') reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RejectTeacherDto) { return this.svc.rejectTeacher(u, id, dto.reason); }
}

/** Teacher: their own profile. Works while they wait for approval (nothing else does). */
@ApiTags('teacher-profile')
@ApiBearerAuth()
@Roles('TEACHER')
@AllowSetup()
@Controller('teacher/profile')
export class TeacherProfileController {
  constructor(private readonly svc: SchoolService) {}

  @Get() get(@CurrentUser() u: AuthUser) { return this.svc.getTeacherProfile(u); }
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Put() submit(@CurrentUser() u: AuthUser, @Body() dto: TeacherProfileDto) { return this.svc.submitTeacherProfile(u, dto); }
}
