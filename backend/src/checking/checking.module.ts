import { Global, Module } from '@nestjs/common';
import { AiClient } from './ai-client.js';
import { CheckingService } from './checking.service.js';
import { RateLimiterService } from './rate-limiter.service.js';

@Global()
@Module({ providers: [AiClient, CheckingService, RateLimiterService], exports: [CheckingService, AiClient, RateLimiterService] })
export class CheckingModule {}
