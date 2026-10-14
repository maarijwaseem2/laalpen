import { Module } from '@nestjs/common';
import { RosterModule } from '../roster/roster.module.js';
import { CaptureModule } from '../capture/capture.module.js';
import { ScanController } from './scan.controller.js';
import { ScanService } from './scan.service.js';
import { SheetsService } from './sheets.service.js';

@Module({ imports: [RosterModule, CaptureModule], controllers: [ScanController], providers: [ScanService, SheetsService], exports: [SheetsService] })
export class ScanModule {}
