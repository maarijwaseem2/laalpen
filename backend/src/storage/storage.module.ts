import { Global, Module } from '@nestjs/common';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({ providers: [StorageService], controllers: [StorageController], exports: [StorageService] })
export class StorageModule {}
