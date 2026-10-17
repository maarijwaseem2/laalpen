import { Transform } from 'class-transformer';
import { IsDateString, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/** Student sign-up: either a school/class code + class/roll/date of birth, or a printed one-time claim code. */
export class ClaimDto {
  @trim() @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() sectionId?: string;
  @trim() @IsOptional() @IsString() @MaxLength(20) claimCode?: string;
  @trim() @IsOptional() @IsString() @MinLength(1) @MaxLength(20) rollNo?: string;
  @trim() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsDateString() dob?: string;
  @trim() @IsOptional() @IsString() @MaxLength(40) admissionNo?: string;
  @lower() @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) guardianPhone?: string;
  // accepted for older apps: same as "code"
  @trim() @IsOptional() @IsString() @MaxLength(30) joinCode?: string;
}

export class ResubmitDto {
  @IsString() sectionId: string;
  @trim() @IsString() @MinLength(1) @MaxLength(20) rollNo: string;
  @IsOptional() @IsDateString() dob?: string;
}

export class UseCodeDto {
  @trim() @IsString() @MinLength(6) @MaxLength(20) code: string;
}

export class ApproveClaimDto {
  /** link to this roster student; empty = add a new roster student */
  @IsOptional() @IsString() studentId?: string;
}

export class RejectDto {
  @trim() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** Family account: one code box. Card code alone links; a class / school code also needs the child's name and roll. */
export class FamilyLinkDto {
  @trim() @IsString() @MinLength(4) @MaxLength(30) code: string;
  @trim() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) childName?: string;
  @trim() @IsOptional() @IsString() @MinLength(1) @MaxLength(20) rollNo?: string;
  @IsOptional() @IsDateString() dob?: string;
  @IsOptional() @IsString() sectionId?: string;
}
