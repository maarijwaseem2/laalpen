import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, Public, Roles, type AuthUser } from '../common/decorators.js';
import { StudentService } from '../student/student.service.js';
import { ParentsService } from './parents.service.js';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

class PhoneStartDto {
  @trim() @IsString() @MinLength(10) @MaxLength(20) phone: string;
}
class PhoneVerifyDto {
  @trim() @IsString() @MinLength(10) @MaxLength(20) phone: string;
  @IsString() @Length(6, 6) code: string;
  @IsOptional() @IsString() @MaxLength(100) deviceId?: string;
  @trim() @IsOptional() @IsString() @MaxLength(80) deviceName?: string;
}

@ApiTags('parents')
@Controller()
export class ParentsController {
  constructor(
    private readonly svc: ParentsService,
    private readonly students: StudentService,
  ) {}

  @Public() @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/phone/start')
  start(@Body() dto: PhoneStartDto) {
    return this.svc.start(dto.phone);
  }

  @Public() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/phone/verify')
  verify(@Body() dto: PhoneVerifyDto, @Req() req: Request) {
    return this.svc.verify(dto.phone, dto.code, { deviceId: dto.deviceId, deviceName: dto.deviceName, ip: (req.ips?.length ? req.ips[0] : req.ip) ?? undefined });
  }

  @ApiBearerAuth() @Roles('PARENT') @Get('parent/children') children(@CurrentUser() u: AuthUser) { return this.svc.children(u.id); }
  @ApiBearerAuth() @Roles('PARENT') @Get('parent/children/:id/dashboard') async dashboard(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.students.dashboard(await this.svc.child(u.id, id)); }
  @ApiBearerAuth() @Roles('PARENT') @Get('parent/children/:id/subjects/:assignmentId') async subject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('assignmentId') a: string) { return this.students.subject(await this.svc.child(u.id, id), a); }
  @ApiBearerAuth() @Roles('PARENT') @Get('parent/results/:id') async result(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.students.result(await this.svc.childOfSubmission(u.id, id), id); }
}
