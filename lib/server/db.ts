/**
 * Prisma client singleton (SQLite via better-sqlite3 driver adapter).
 * The global stash keeps Next dev hot-reload from leaking connections.
 */

import path from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@/lib/generated/prisma/client';

const url =
  process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`;

const globalForDb = globalThis as unknown as { __sgDb?: PrismaClient };

export const db =
  globalForDb.__sgDb ??
  new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

if (process.env.NODE_ENV !== 'production') globalForDb.__sgDb = db;
