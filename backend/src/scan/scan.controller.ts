import { Body, Controller, HttpCode, Param, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators.js';
import { env } from '../config/env.js';
import { ScanService, type StackFile } from './scan.service.js';

class SheetsDto {
  @IsOptional() @IsIn(['booklet', 'stickers']) format?: 'booklet' | 'stickers';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) pages?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) studentIds?: string[];
}

@ApiTags('teacher-scan')
@ApiBearerAuth()
@Roles('TEACHER')
@Controller('teacher/tests')
export class ScanController {
  constructor(private readonly svc: ScanService) {}

  /** Answer booklets (or QR stickers) with each student's name, roll and page number. */
  @HttpCode(200) @Post(':id/booklets') booklets(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SheetsDto) { return this.svc.booklets(u, id, dto); }

  /** OMR bubble sheets for an all-MCQ test. */
  @HttpCode(200) @Post(':id/omr-sheets') omr(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SheetsDto) { return this.svc.omrSheets(u, id, dto.studentIds); }

  /** The whole pile of photos, any order: matched to students by QR; OMR sheets marked at once. */
  @HttpCode(200)
  @Post(':id/stack')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('pages', 80, { limits: { fileSize: env.maxUploadMb * 1024 * 1024 } }))
  stack(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFiles() files: StackFile[]) {
    return this.svc.stack(u, id, files ?? []);
  }
}
