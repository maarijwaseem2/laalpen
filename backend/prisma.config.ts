import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // read from backend/.env; empty is fine for `prisma generate` (e.g. during npm install)
    url: process.env.DATABASE_URL ?? '',
  },
});
