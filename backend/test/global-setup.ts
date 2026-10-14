import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import pg from 'pg';

/**
 * Creates a fresh, empty database just for this test run, applies the migrations to it
 * (non-destructive `prisma migrate deploy`), and removes that same temporary database afterwards.
 * Your development database is never touched.
 */
export default async function setup() {
  const base = process.env.LAALPEN_TEST_DB_BASE!;
  const name = process.env.LAALPEN_TEST_DB!;
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: `${base}/${name}?schema=public` } });
  rmSync('./.test-uploads', { recursive: true, force: true });

  return async () => {
    rmSync('./.test-uploads', { recursive: true, force: true });
    const c = new pg.Client({ connectionString: `${base}/postgres` });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); // only the temporary DB created above
    await c.end();
  };
}
