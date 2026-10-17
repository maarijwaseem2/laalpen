import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/swagger';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class CreateClassDto {
  @trim() @IsString() @MinLength(1) @MaxLength(40) name: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(16) grade: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) sections?: string[];
}
export class UpdateClassDto {
  @trim() @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(16) grade?: number;
}

export class SectionDto {
  @trim() @IsString() @MinLength(1) @MaxLength(20) name: string;
}

export class SubjectDto {
  @trim() @IsString() @MinLength(1) @MaxLength(60) name: string;
  @trim() @IsOptional() @IsString() @MaxLength(12) code?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
}
export class UpdateSubjectDto extends PartialType(SubjectDto) {}

export class CreateTeacherDto {
  @trim() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @lower() @IsEmail() email: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) phone?: string;
}
export class UpdateTeacherDto {
  @trim() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AssignmentDto {
  @IsString() teacherId: string;
  @IsString() sectionId: string;
  @IsString() subjectId: string;
}

export class CreateStudentDto {
  @trim() @IsString() @MinLength(2) @MaxLength(80) name: string;
  /** optional: with an email an app account is created and its password emailed */
  @lower() @IsOptional() @IsEmail() email?: string;
  @IsString() sectionId: string;
  @trim() @IsString() @MinLength(1) @MaxLength(20) rollNo: string;
  @trim() @IsOptional() @IsString() @MaxLength(40) admissionNo?: string;
  @trim() @IsOptional() @IsString() @MaxLength(80) fatherName?: string;
  @IsOptional() @IsDateString() dob?: string;
  @trim() @IsOptional() @IsString() @MaxLength(10) gender?: string;
  @trim() @IsOptional() @Matches(/^[\d-\s]{13,17}$/, { message: 'B-Form must have 13 digits' }) bForm?: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @trim() @IsOptional() @IsString() @MaxLength(80) guardianName?: string;
  @lower() @IsOptional() @IsEmail() guardianEmail?: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) guardianPhone?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}
export class UpdateStudentDto {
  @trim() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() sectionId?: string;
  @trim() @IsOptional() @IsString() @MinLength(1) @MaxLength(20) rollNo?: string;
  @trim() @IsOptional() @IsString() @MaxLength(40) admissionNo?: string;
  @trim() @IsOptional() @IsString() @MaxLength(80) fatherName?: string;
  @IsOptional() @IsDateString() dob?: string | null;
  @trim() @IsOptional() @IsString() @MaxLength(10) gender?: string;
  @trim() @IsOptional() @Matches(/^[\d-\s]{13,17}$/, { message: 'B-Form must have 13 digits' }) bForm?: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @trim() @IsOptional() @IsString() @MaxLength(80) guardianName?: string;
  @lower() @IsOptional() @IsEmail() guardianEmail?: string;
  @trim() @IsOptional() @IsString() @MaxLength(30) guardianPhone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class LeaveDto {
  @trim() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class SessionDto {
  @trim() @Matches(/^\d{4}-\d{2}$/, { message: 'Write the session like 2027-28' }) name: string;
  @IsOptional() @IsDateString() startsOn?: string;
  @IsOptional() @IsBoolean() makeCurrent?: boolean;
}

export class PromoteDto {
  @IsString() fromClassId: string;
  /** empty = the class graduates (leaves the school) */
  @IsOptional() @IsString() toClassId?: string | null;
  @trim() @Matches(/^\d{4}-\d{2}$/, { message: 'Write the session like 2027-28' }) sessionName: string;
  /** students who repeat the class */
  @IsOptional() @IsArray() @IsString({ each: true }) retainIds?: string[];
  @IsOptional() @IsBoolean() renumber?: boolean;
}

export class CardsDto {
  @IsOptional() @IsString() sectionId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) studentIds?: string[];
  @IsOptional() @IsIn(['STUDENT', 'PARENT']) kind?: 'STUDENT' | 'PARENT';
}

export class QuickAddDto {
  /** one student per line: "01 Ali Raza" or "01, Ali Raza, 0300 1234567" */
  @IsString() @MinLength(3) @MaxLength(20000) text: string;
}
