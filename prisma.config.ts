import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Single-file SQLite database for dev; Postgres later just swaps this URL.
process.env.DATABASE_URL ??= `file:${path.join(__dirname, 'prisma', 'dev.db')}`;

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: 'npx tsx prisma/seed.ts',
  },
});
