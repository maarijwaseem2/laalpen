import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Every test run gets its own brand-new database, so tests never touch your real data.
const base = process.env.TEST_DATABASE_BASE_URL || 'postgresql://postgres@localhost:5432';
const testDb = `laalpen_test_${Date.now().toString(36)}`;
process.env.LAALPEN_TEST_DB = testDb;
process.env.LAALPEN_TEST_DB_BASE = base;
const testUrl = `${base}/${testDb}?schema=public`;

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testUrl,
      UPLOAD_DIR: './.test-uploads',
      AI_SERVICE_URL: 'http://127.0.0.1:18765',
      AI_SERVICE_TOKEN: 'test-ai-token',
      BREVO_API_KEY: '',
      CHECKING_CONCURRENCY: '1',
      AI_REQUESTS_PER_MINUTE: '100000',
      // most specs log admins in with a password only; security.spec.ts turns these on
      REQUIRE_ADMIN_2FA: 'false',
      DEVICE_CONFIRM_ROLES: '',
      BREACHED_PASSWORD_CHECK: 'false',
    },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
