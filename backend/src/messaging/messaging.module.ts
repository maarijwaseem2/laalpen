import { Global, Module } from '@nestjs/common';
import { MessagingService } from './messaging.service.js';

@Global()
@Module({ providers: [MessagingService], exports: [MessagingService] })
export class MessagingModule {}
