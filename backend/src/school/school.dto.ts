import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class ClassInputDto {
  @trim() @IsString() @MinLength(1) @MaxLength(40) name: string;
  @IsOptional() @IsInt() @Min(0) @Max(20) grade?: number;
  @IsArray() @ArrayMinSize(1, { message: 'Every class needs at least one section, e.g. A' }) @ArrayMaxSize(26) @IsString({ each: true }) @MaxLength(20, { each: true }) sections: string[];
}

/** First sign-in of a principal: the school profile, classes and sections. */
export class SchoolProfileDto {
  @trim() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @trim() @IsString() @MinLength(3, { message: 'Enter the school address' }) @MaxLength(200) address: string;
  @trim() @IsString() @MinLength(2, { message: 'Enter the city' }) @MaxLength(80) city: string;
  @trim() @IsString() @Matches(/^[+0-9][0-9 ()-]{6,19}$/, { message: 'Enter the school phone number, e.g. 021 34567890' }) phone: string;
  @trim() @IsOptional() @IsString() @MaxLength(80) board?: string;
  @trim() @IsOptional() @IsString() @MaxLength(500) @Matches(/^(https:\/\/|$)/, { message: 'The logo must be an https:// link' }) logoUrl?: string;
  @IsArray() @ArrayMinSize(1, { message: 'Add at least one class with a section' }) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ClassInputDto) classes: ClassInputDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(60, { each: true }) subjects?: string[];
}

export class TeachingPairDto {
  @IsString() sectionId: string;
  @trim() @IsString() @MinLength(2) @MaxLength(60) subject: string;
}

/** First sign-in of a teacher: who they are and what they teach (goes to the principal for approval). */
export class TeacherProfileDto {
  @trim() @IsString() @MinLength(3, { message: 'Enter your full name' }) @MaxLength(80) name: string;
  @trim() @IsString() @Matches(/^[+0-9][0-9 ()-]{9,19}$/, { message: 'Enter your mobile number, e.g. 0300 1234567' }) phone: string;
  @trim() @IsString() @MinLength(2, { message: 'Enter your education, e.g. MSc Physics, B.Ed' }) @MaxLength(200) qualification: string;
  @IsArray() @ArrayMinSize(1, { message: 'Add the subjects you teach' }) @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(60, { each: true }) subjects: string[];
  @IsArray() @ArrayMinSize(1, { message: 'Choose at least one class and its subject, e.g. 9-A Maths' }) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => TeachingPairDto) sections: TeachingPairDto[];
}

export class RejectTeacherDto {
  @trim() @IsString() @MinLength(3, { message: 'Tell the teacher why (they will see it)' }) @MaxLength(300) reason: string;
}
