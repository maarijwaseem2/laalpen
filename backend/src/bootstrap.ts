import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { env } from './config/env.js';

/** Shared app setup used by main.ts and the automated tests. */
export function configureApp(app: INestApplication) {
  // behind a hosting proxy / load balancer, read the real client IP (used for rate limits and audit logs).
  // TRUST_PROXY = number of proxies in front of the app (Render: 2-3; one plain proxy: 1), or an Express trust value.
  const tp = process.env.TRUST_PROXY?.trim();
  const trust = !tp ? 1 : /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp === 'false' ? false : tp;
  (app.getHttpAdapter().getInstance() as { set?: (k: string, v: unknown) => void }).set?.('trust proxy', trust);
  const http = app.getHttpAdapter().getInstance() as { disable?: (k: string) => void; use?: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void };
  http.disable?.('x-powered-by');
  // Hosts behind Cloudflare (Render) put the real visitor IP in a header the visitor cannot forge, e.g. CLIENT_IP_HEADER=cf-connecting-ip.
  // Without this every request looks like it comes from the host's proxies, so per-IP rate limits and audit IPs are wrong.
  const ipHeader = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (ipHeader) {
    http.use?.((req, _res, next) => {
      const r = req as { headers: Record<string, string | string[] | undefined> };
      const raw = r.headers[ipHeader];
      const ip = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
      if (ip) {
        Object.defineProperty(r, 'ip', { value: ip, configurable: true });
        Object.defineProperty(r, 'ips', { value: [ip], configurable: true });
      }
      next();
    });
  }
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
