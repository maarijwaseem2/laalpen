import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/throttler.guard.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { MailModule } from './mail/mail.module.js';
import { StorageModule } from './storage/storage.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AuditModule } from './audit/audit.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CheckingModule } from './checking/checking.module.js';
import { AdminModule } from './admin/admin.module.js';
import { TeacherModule } from './teacher/teacher.module.js';
import { StudentModule } from './student/student.module.js';
import { RosterModule } from './roster/roster.module.js';
import { ClaimsModule } from './claims/claims.module.js';
import { ParentsModule } from './parents/parents.module.js';
import { CaptureModule } from './capture/capture.module.js';
import { ScanModule } from './scan/scan.module.js';
import { InsightsModule } from './insights/insights.module.js';
import { ShareModule } from './share/share.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { SchoolModule } from './school/school.module.js';
import { HealthController } from './health/health.controller.js';
import { KeepAliveService } from './health/keepalive.service.js';
import { AuthGuard } from './common/auth.guard.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { env } from './config/env.js';

@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: env.isTest ? 10_000 : 300 }], skipIf: () => env.isTest && process.env.THROTTLE_IN_TESTS !== 'true' }),
    PrismaModule,
    MailModule,
    StorageModule,
    NotificationsModule,
    AuditModule,
    TenantModule,
    MessagingModule,
    AuthModule,
    CheckingModule,
    RosterModule,
    AdminModule,
    TeacherModule,
    StudentModule,
    ClaimsModule,
    ParentsModule,
    CaptureModule,
    ScanModule,
    InsightsModule,
    ShareModule,
    PlatformModule,
    SchoolModule,
  ],
  controllers: [HealthController],
  providers: [
    KeepAliveService,
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
