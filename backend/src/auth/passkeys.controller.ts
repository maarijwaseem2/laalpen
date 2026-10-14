import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { AllowWithoutMfa, CurrentUser, Public, type AuthUser } from '../common/decorators.js';
import { PasskeysService } from './passkeys.service.js';

class VerifyDto {
  @IsString() challengeId: string;
  @IsObject() response: any;
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(100) deviceId?: string;
  @IsOptional() @IsString() @MaxLength(80) deviceName?: string;
}
class OptionsDto {
  @IsOptional() @IsEmail() email?: string;
}

@ApiTags('passkeys')
@Controller('auth/passkeys')
export class PasskeysController {
  constructor(private readonly svc: PasskeysService) {}

  @ApiBearerAuth() @AllowWithoutMfa() @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.id); }
  @ApiBearerAuth() @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.remove(u.id, id); }

  /** Admins may add a passkey instead of the authenticator app, so this works before 2FA is set up. */
  @ApiBearerAuth() @AllowWithoutMfa() @HttpCode(200) @Post('register/options') registerOptions(@CurrentUser() u: AuthUser) { return this.svc.registerOptions(u.id); }
  @ApiBearerAuth() @AllowWithoutMfa() @HttpCode(200) @Post('register/verify') registerVerify(@CurrentUser() u: AuthUser, @Body() dto: VerifyDto) { return this.svc.registerVerify(u.id, dto.challengeId, dto.response, dto.name); }

  @Public() @HttpCode(200) @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Post('login/options') loginOptions(@Body() dto: OptionsDto) { return this.svc.loginOptions(dto.email); }
  @Public() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('login/verify')
  loginVerify(@Body() dto: VerifyDto, @Req() req: Request) {
    return this.svc.loginVerify(dto.challengeId, dto.response, { deviceId: dto.deviceId, deviceName: dto.deviceName, ip: (req.ips?.length ? req.ips[0] : req.ip) ?? undefined });
  }
}
