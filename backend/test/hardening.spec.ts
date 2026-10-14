import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../src/bootstrap.js';
import { productionConfigProblems } from '../src/config/env.js';

// a tiny app with the real HTTP setup only: no database or queue workers, so it cannot disturb other suites
@Controller('health') class Ping { @Get() ok() { return { status: 'ok' }; } }
@Module({ controllers: [Ping] }) class PingModule {}

describe('hardening', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [PingModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
  });
  afterAll(async () => { await app?.close(); });

  it('API responses carry security headers and no x-powered-by', async () => {
    const r = await request(app.getHttpServer()).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('a production server with development secrets or open CORS refuses to start', () => {
    const strong = 'x'.repeat(40);
    const good = { isProd: true, corsOrigins: 'https://app.laalpen.pk', jwtAccessSecret: strong, fileSigningSecret: strong, dataEncryptionKey: strong, totpEncryptionKey: strong };
    expect(productionConfigProblems(good)).toEqual([]);
    expect(productionConfigProblems({ ...good, jwtAccessSecret: 'dev-access-secret-change-me' })).toHaveLength(1);
    expect(productionConfigProblems({ ...good, corsOrigins: '*' })[0]).toMatch(/CORS/);
    expect(productionConfigProblems({ ...good, isProd: false, corsOrigins: '*', jwtAccessSecret: '' })).toEqual([]);
  });
});
