import { Module } from '@nestjs/common';
import { CaptureController } from './capture.controller.js';
import { CaptureService } from './capture.service.js';

@Module({ controllers: [CaptureController], providers: [CaptureService], exports: [CaptureService] })
export class CaptureModule {}
