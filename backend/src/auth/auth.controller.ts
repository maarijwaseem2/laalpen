import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AllowWithoutMfa, CurrentUser, Public, type AuthUser } from '../common/decorators.js';
import { AuthService } from './auth.service.js';
import { SecurityService } from './security.service.js';
import {
  ChangePasswordDto, ForgotPasswordDto, GoogleLoginDto, LoginDto, RefreshDto, RegisterSchoolDto,
  ResendOtpDto, ResetPasswordDto, StepUpDto, TotpCodeDto, UpdateMeDto, VerifyEmailWithDeviceDto, VerifyLoginDto,
} from './auth.dto.js';

const ip = (req: Request) => (req.ips?.length ? req.ips[0] : req.ip) ?? undefined;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly security: SecurityService,
  ) {}

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterSchoolDto) {
    return this.auth.registerSchool(dto);
  }

  @Public() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  verify(@Body() dto: VerifyEmailWithDeviceDto, @Req() req: Request) {
    return this.auth.verifyEmail(dto.email, dto.code, { deviceId: dto.deviceId, deviceName: dto.deviceName, ip: ip(req) });
  }

  @Public() @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-otp')
  resend(@Body() dto: ResendOtpDto) {
    return this.auth.resendOtp(dto.email, dto.purpose);
  }

  @Public() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, { deviceId: dto.deviceId, deviceName: dto.deviceName, ip: ip(req) });
  }

  /** Second step: authenticator / backup code, or the emailed code for a new device. */
  @Public() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login/verify')
  verifyLogin(@Body() dto: VerifyLoginDto, @Req() req: Request) {
    return this.auth.verifyLogin(dto.challengeId, dto.code, { deviceId: dto.deviceId, deviceName: dto.deviceName, ip: ip(req) });
  }

  @Public() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('google')
  google(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    return this.auth.googleLogin(dto.idToken, { deviceId: dto.deviceId, deviceName: dto.deviceName, ip: ip(req) });
  }

  @Public() @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Public() @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public() @HttpCode(200)
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  /** Link from security emails: signs the account out everywhere. */
  @Public() @ApiExcludeEndpoint()
  @Get('secure-account')
  async secureAccount(@Query('u') u: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const ok = this.security.verifyPanic(u, Number(exp), sig);
    if (ok) await this.security.secureAccount(u);
    res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:Arial;max-width:480px;margin:40px auto;padding:0 16px;color:#1B2A4A">
      <h2 style="color:#C8102E">LaalPen</h2>${ok ? '<p><b>Done.</b> Every device was signed out of your account.</p><p>Now open the app and use <b>Forgot password</b> to set a new password.</p>' : '<p>This link has expired. Open the app and use <b>Forgot password</b>.</p>'}</body>`);
  }

  @ApiBearerAuth() @AllowWithoutMfa()
  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.id);
  }

  @ApiBearerAuth() @AllowWithoutMfa()
  @Patch('me')
  updateMe(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(u.id, dto);
  }

  @ApiBearerAuth() @HttpCode(200) @AllowWithoutMfa()
  @Post('change-password')
  changePassword(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(u.id, u.sid, dto);
  }

  /** Re-enter password / authenticator code / Google before a sensitive action. */
  @ApiBearerAuth() @HttpCode(200) @AllowWithoutMfa() @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('step-up')
  stepUp(@CurrentUser() u: AuthUser, @Body() dto: StepUpDto) {
    return this.auth.stepUp(u.id, u.sid, dto);
  }

  /** Devices where this account is signed in right now. */
  @ApiBearerAuth() @AllowWithoutMfa()
  @Get('sessions')
  sessions(@CurrentUser() u: AuthUser) {
    return this.auth.listSessions(u.id, u.sid);
  }

  @ApiBearerAuth() @AllowWithoutMfa()
  @Delete('sessions/:id')
  endSession(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.auth.endSession(u.id, id);
  }

  @ApiBearerAuth() @HttpCode(200) @AllowWithoutMfa()
  @Post('logout-all')
  logoutAll(@CurrentUser() u: AuthUser) {
    return this.auth.logoutAll(u.id);
  }

  // ---------- authenticator app (2FA) ----------

  @ApiBearerAuth() @HttpCode(200) @AllowWithoutMfa()
  @Post('2fa/setup')
  setup2fa(@CurrentUser() u: AuthUser) {
    return this.security.startTotpSetup(u.id);
  }

  @ApiBearerAuth() @HttpCode(200) @AllowWithoutMfa() @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/enable')
  async enable2fa(@CurrentUser() u: AuthUser, @Body() dto: TotpCodeDto) {
    const r = await this.security.enableTotp(u.id, dto.code);
    return { ...r, user: await this.auth.me(u.id) };
  }

  @ApiBearerAuth() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/disable')
  disable2fa(@CurrentUser() u: AuthUser, @Body() dto: TotpCodeDto) {
    return this.security.disableTotp(u.id, dto.code, u.role);
  }

  @ApiBearerAuth() @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/backup-codes')
  async backupCodes(@CurrentUser() u: AuthUser, @Body() dto: TotpCodeDto) {
    if (!(await this.security.checkTotp(u.id, dto.code))) throw new BadRequestException('That code is not right');
    return { backupCodes: await this.security.newBackupCodes(u.id) };
  }

  // ---------- devices ----------

  @ApiBearerAuth() @AllowWithoutMfa()
  @Get('devices')
  devices(@CurrentUser() u: AuthUser) {
    return this.security.listDevices(u.id);
  }

  @ApiBearerAuth() @AllowWithoutMfa()
  @Delete('devices/:id')
  forgetDevice(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.security.forgetDevice(u.id, id);
  }
}
