import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { env, productionConfigProblems } from './config/env.js';
import { MonitoringFilter, initMonitoring, reportError } from './common/monitoring.js';

async function main() {
  const problems = productionConfigProblems();
  if (problems.length) {
    Logger.error(`Refusing to start in production:\n - ${problems.join('\n - ')}`, 'Bootstrap');
    process.exit(1);
  }
  await initMonitoring(env.processRole);
  process.on('unhandledRejection', (e) => reportError(e, { where: 'unhandledRejection' }));
  if (env.processRole === 'worker') {
    // queue workers only (no HTTP): scale with `LAALPEN_ROLE=worker node dist/main.js`
    const ctx = await NestFactory.createApplicationContext(AppModule);
    ctx.enableShutdownHooks();
    Logger.log('LaalPen worker running (checking queues)', 'Bootstrap');
    return;
  }
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  if (process.env.SENTRY_DSN) app.useGlobalFilters(new MonitoringFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  await app.listen(env.port, '0.0.0.0');
  Logger.log(`LaalPen API ready on http://localhost:${env.port}/api  (docs: /api/docs) [role: ${env.processRole}]`, 'Bootstrap');
}
main();
