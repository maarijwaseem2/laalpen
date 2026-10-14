import { Module } from '@nestjs/common';
import { RosterModule } from '../roster/roster.module.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({ imports: [RosterModule], controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
