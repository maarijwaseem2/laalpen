import { Global, Module } from '@nestjs/common';
import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';

@Global()
@Module({ controllers: [ShareController], providers: [ShareService], exports: [ShareService] })
export class ShareModule {}
