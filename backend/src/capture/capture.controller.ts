import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators.js';
import { CaptureService } from './capture.service.js';

class PresignDto {
  @IsString() testId: string;
  @IsString() studentId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(40) pageNo: number;
  /** id the phone gave this page (UUID) */
  @Matches(/^[A-Za-z0-9_-]{8,64}$/) localId: string;
  @IsOptional() @IsIn(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']) contentType?: string;
}

class PageRefDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(40) pageNo: number;
  @Matches(/^[A-Za-z0-9_-]{8,64}$/) localId: string;
  @IsString() key: string;
}

class ConfirmDto {
  @IsString() testId: string;
  @IsString() studentId: string;
  @IsOptional() @IsString() batchId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => PageRefDto) pages: PageRefDto[];
}

@ApiTags('capture')
@ApiBearerAuth()
@Roles('TEACHER')
@Controller('teacher')
export class CaptureController {
  constructor(private readonly svc: CaptureService) {}

  @HttpCode(200) @Post('tests/:id/batches') open(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.openBatch(u, id); }
  @Get('batches/:id') progress(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.progress(u, id); }
  @HttpCode(200) @Post('batches/:id/close') close(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.closeBatch(u, id); }
  @HttpCode(200) @Post('uploads/presign') presign(@CurrentUser() u: AuthUser, @Body() dto: PresignDto) { return this.svc.presign(u, dto); }
  @HttpCode(200) @Post('uploads/confirm') confirm(@CurrentUser() u: AuthUser, @Body() dto: ConfirmDto) { return this.svc.confirm(u, dto); }
}
