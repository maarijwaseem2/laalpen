import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';

@Module({ controllers: [PlatformController], providers: [PlatformService] })
export class PlatformModule {}
