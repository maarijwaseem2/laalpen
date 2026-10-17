import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, StepUp, type AuthUser } from '../common/decorators.js';
import { InsightsService } from './insights.service.js';

@ApiTags('admin-insights')
@ApiBearerAuth()
@Roles('PRINCIPAL')
@Controller('admin')
export class InsightsController {
  constructor(private readonly svc: InsightsService) {}

  @Get('insights') insights(@CurrentUser() u: AuthUser, @Query('days') days?: string) { return this.svc.insights(u.schoolId!, days ? Number(days) || 30 : 30); }

  /** Every published mark of the session for the board portal / ERP. Whole-school data: confirm it's you. */
  @StepUp() @Get('export/results') export(@CurrentUser() u: AuthUser, @Query('format') format?: string, @Query('sessionId') sessionId?: string) {
    return this.svc.export(u, format === 'csv' ? 'csv' : 'xlsx', sessionId || undefined);
  }
}
