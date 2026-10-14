import { Module } from '@nestjs/common';
import { ClaimsController } from './claims.controller.js';
import { ClaimsService } from './claims.service.js';
import { RosterModule } from '../roster/roster.module.js';

@Module({ imports: [RosterModule], controllers: [ClaimsController], providers: [ClaimsService], exports: [ClaimsService] })
export class ClaimsModule {}
