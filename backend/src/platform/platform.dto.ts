import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class CreateSchoolDto {
  @trim() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @trim() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @trim() @IsString() @MinLength(2) @MaxLength(80) principalName: string;
  @lower() @IsEmail({}, { message: 'Enter the principal’s email address' }) principalEmail: string;
}

export class AddPrincipalDto {
  @trim() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @lower() @IsEmail({}, { message: 'Enter a valid email address' }) email: string;
}

export class SuspendDto {
  @trim() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
