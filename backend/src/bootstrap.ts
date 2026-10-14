import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { env } from './config/env.js';

/** Shared app setup used by main.ts and the automated tests. */
export function configureApp(app: INestApplication) {
  // behind a hosting proxy / load balancer, read the real client IP (used for rate limits)
  (app.getHttpAdapter().getInstance() as { set?: (k: string, v: unknown) => void }).set?.('trust proxy', 1);
  const http = app.getHttpAdapter().getInstance() as { disable?: (k: string) => void; use?: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void };
  http.disable?.('x-powered-by');
  // basic security headers (an API never needs to be framed or sniffed as HTML)
  http.use?.((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (env.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.setGlobalPrefix('api', { exclude: ['files', 'files/upload'] });
  app.enableCors({ origin: env.corsOrigins === '*' ? true : env.corsOrigins.split(',').map((s) => s.trim()), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      exceptionFactory: (errors) => {
        const first = errors[0];
        const msg = first?.constraints ? Object.values(first.constraints)[0] : first?.children?.[0]?.children?.[0]?.constraints ? Object.values(first.children[0].children[0].constraints!)[0] : 'Invalid input';
        return new BadRequestException({ message: msg, errors: errors.map((e) => ({ field: e.property, messages: Object.values(e.constraints ?? {}) })) });
      },
    }),
  );
  const config = new DocumentBuilder().setTitle('LaalPen API').setDescription('AI copy checking for schools').setVersion('1.0').addBearerAuth().build();
  // the full API map is for developers; hide it on a production server unless asked for
  if (!env.isProd || process.env.API_DOCS === 'true') SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
  return app;
}
