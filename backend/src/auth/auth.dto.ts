import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
// NIST SP 800-63B-4: length + a block list (checked in the service), no "must contain a digit/symbol" rules
const PASSWORD_RULE = /^[\s\S]{8,128}$/;
const PASSWORD_MSG = 'Password must be 8 to 128 characters (a short sentence works well)';

/** The only public sign-up: a Parent / Student account. */
export class RegisterParentDto {
  @trim() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @lower() @IsEmail({}, { message: 'Enter a valid email address' }) email: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) password: string;
}

export class DeviceDto {
  /** random id the app keeps in secure storage; identifies "this phone" without fingerprinting */
  @IsOptional() @IsString() @MaxLength(100) deviceId?: string;
  @trim() @IsOptional() @IsString() @MaxLength(80) deviceName?: string;
}

/** Parent / Student password sign-in: email OR Pakistani mobile number. */
export class LoginDto extends DeviceDto {
  @lower() @IsOptional() @IsEmail({}, { message: 'Enter a valid email address' }) email?: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}

/** Staff sign-in, step 1: email the one-time code. */
export class EmailCodeStartDto {
  @lower() @IsEmail({}, { message: 'Enter a valid email address' }) email: string;
}

/** Staff sign-in, step 2: the 6-digit code from the email (or the email link). */
export class EmailCodeVerifyDto extends DeviceDto {
  @lower() @IsEmail() email: string;
  @trim() @IsString() @Length(6, 6, { message: 'Enter the 6-digit code' }) code: string;
}

export class VerifyLoginDto extends DeviceDto {
  @IsString() @MinLength(10) challengeId: string;
  @trim() @IsString() @MinLength(6) @MaxLength(20) code: string;
}

export class TotpCodeDto {
  @trim() @IsString() @MinLength(6) @MaxLength(20) code: string;
}

export class VerifyEmailDto {
  @lower() @IsEmail() email: string;
  @IsString() @Length(6, 6) code: string;
}

export class ResendOtpDto {
  @lower() @IsEmail() email: string;
  @IsIn(['VERIFY_EMAIL', 'RESET_PASSWORD']) purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD';
}

export class ForgotPasswordDto {
  @lower() @IsEmail() email: string;
}

export class ResetPasswordDto {
  @lower() @IsEmail() email: string;
  @IsString() @Length(6, 6) code: string;
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) password: string;
}

export class GoogleLoginDto extends DeviceDto {
  @IsString() @MinLength(10) idToken: string;
  /** Parent / Student sign-up with Google (never creates staff) */
  @IsOptional() @IsBoolean() signup?: boolean;
}

export class RefreshDto {
  @IsString() @MinLength(10) refreshToken: string;
}

export class UpdateMeDto {
  @trim() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) phone?: string;
}

export class ChangePasswordDto {
  @IsOptional() @IsString() currentPassword: string;
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG }) newPassword: string;
}

export class StepUpDto {
  @IsOptional() @IsString() @MaxLength(200) password?: string;
  @trim() @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsOptional() @IsString() @MaxLength(4000) idToken?: string;
  /** staff: the code emailed by POST /auth/step-up/email */
  @trim() @IsOptional() @IsString() @Length(6, 6) emailCode?: string;
}

export class VerifyEmailWithDeviceDto extends DeviceDto {
  @lower() @IsEmail() email: string;
  @IsString() @Length(6, 6) code: string;
}
