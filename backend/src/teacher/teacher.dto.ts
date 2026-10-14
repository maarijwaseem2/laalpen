import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max,
  MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class KeyStepDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) marks: number;
  @trim() @IsString() @MinLength(1) @MaxLength(300) description: string;
}

export class KeyRuleDto {
  @trim() @Matches(/^R\d{1,2}$/, { message: 'Rule ids look like R1, R2 …' }) id: string;
  @trim() @IsString() @MinLength(1) @MaxLength(300) text: string;
}

export class QuestionDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(200) number: number;
  @trim() @IsString() @MinLength(1) @MaxLength(2000) text: string;
  @Type(() => Number) @IsNumber() @Min(0.5) @Max(100) maxMarks: number;
  @trim() @IsString() @MaxLength(5000) answerKey: string;
  @IsOptional() @IsIn(['THEORY', 'NUMERIC', 'MCQ']) type?: 'THEORY' | 'NUMERIC' | 'MCQ';
  @trim() @IsOptional() @IsString() @MaxLength(300) finalAnswer?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) alternatives?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => KeyStepDto) steps?: KeyStepDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => KeyRuleDto) rules?: KeyRuleDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) options?: string[];
  @trim() @IsOptional() @IsString() @MaxLength(120) topic?: string | null;
}

export class CreateTestDto {
  @trim() @IsString() @MinLength(2) @MaxLength(120) title: string;
  @trim() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsDateString() testDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(40) expectedPages?: number;
  @IsOptional() @IsIn(['en', 'ur']) language?: 'en' | 'ur';
  @IsOptional() @IsIn(['INSTANT', 'OVERNIGHT']) gradingMode?: 'INSTANT' | 'OVERNIGHT';
  /** confirm the key right away (the app shows the "Check answer key" screen first) */
  @IsOptional() @IsBoolean() confirmKey?: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions: QuestionDto[];
}

export class UpdateTestDto {
  @trim() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @trim() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsDateString() testDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(40) expectedPages?: number | null;
  @IsOptional() @IsIn(['en', 'ur']) language?: 'en' | 'ur';
  @IsOptional() @IsIn(['INSTANT', 'OVERNIGHT']) gradingMode?: 'INSTANT' | 'OVERNIGHT';
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions?: QuestionDto[];
}

export class DraftKeyDto {
  @trim() @IsOptional() @IsString() @MaxLength(20000) text?: string;
}

export class ConfirmKeyDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions: QuestionDto[];
  /** re-check copies that were already checked with the old key */
  @IsOptional() @IsBoolean() recheck?: boolean;
}

export class UpdateAnswerDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) finalMarks?: number;
  @trim() @IsOptional() @IsString() @MaxLength(500) comment?: string;
  /** why the AI's mark was changed: "AI misread", "Alternative method", ... */
  @trim() @IsOptional() @IsString() @MaxLength(120) overrideReason?: string;
  /** undo: go back to the AI's marks and comment */
  @IsOptional() @IsBoolean() revert?: boolean;
}

export class UploadQueryDto {
  @IsOptional() @IsIn(['interactive', 'bulk']) mode?: 'interactive' | 'bulk';
}

export class IdsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) ids: string[];
}

export class GroupMarkDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) answerIds: string[];
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) finalMarks: number;
  @trim() @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class CommentDto {
  @trim() @IsString() @MinLength(1) @MaxLength(120) text: string;
  @IsOptional() @IsIn(['en', 'ur']) lang?: 'en' | 'ur';
}

export class ReopenDto {
  @trim() @IsString() @MinLength(5) @MaxLength(300) reason: string;
}
