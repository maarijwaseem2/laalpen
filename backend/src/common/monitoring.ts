import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Optional error monitoring. Set SENTRY_DSN (free tier is enough for a school) and every server error
 * is reported with its route — never request bodies, so no student data leaves the server.
 */
let sentry: typeof import('@sentry/node') | null = null;

export async function initMonitoring(role: string) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  sentry = await import('@sentry/node');
  sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.APP_VERSION,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
    sendDefaultPii: false,
    initialScope: { tags: { role } },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) delete event.request.headers.authorization;
      }
      return event;
    },
  });
  Logger.log('Error monitoring on (Sentry)', 'Monitoring');
}

export function reportError(err: unknown, context?: Record<string, unknown>) {
  if (!sentry) return;
  sentry.withScope((scope) => {
    if (context) scope.setContext('laalpen', context);
    sentry!.captureException(err);
  });
}

/** Reports unexpected (5xx) errors; normal 4xx answers are not errors. */
@Catch()
export class MonitoringFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<{ method?: string; route?: { path?: string } }>();
      reportError(exception, { method: req?.method, route: req?.route?.path });
    }
    super.catch(exception, host);
  }
}
