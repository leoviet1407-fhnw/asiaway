import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, createPgliteDatabase, createPostgresDatabase, type AppDatabase } from './client';

/**
 * The application's database handle.
 *
 * With DATABASE_URL set, this is ordinary PostgreSQL — that is production.
 *
 * Without it, the app falls back to a file-backed PGlite database and migrates
 * itself on first use. That is what lets `npm run dev` work on a laptop with no
 * Docker and no database server, which matters a great deal for a demo that the
 * restaurant needs to try before any hosting decision has been made.
 */
const globalRef = globalThis as unknown as {
  __asiawayDb?: Promise<{ db: AppDatabase; mode: 'postgres' | 'pglite' }>;
};

async function create(): Promise<{ db: AppDatabase; mode: 'postgres' | 'pglite' }> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { db } = createPostgresDatabase(url);
    return { db, mode: 'postgres' };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }

  const dir = resolve(process.cwd(), '.pglite');
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(resolve(dir, 'asiaway'));

  const existing = await client.query<{ n: number }>(
    "select count(*)::int as n from information_schema.tables where table_name = 'orders'",
  );
  if ((existing.rows[0]?.n ?? 0) === 0) {
    await applyMigrations(client);
  }

  const { db } = createPgliteDatabase(client);
  return { db, mode: 'pglite' };
}

export function getDatabase(): Promise<{ db: AppDatabase; mode: 'postgres' | 'pglite' }> {
  return (globalRef.__asiawayDb ??= create());
}

export async function db(): Promise<AppDatabase> {
  return (await getDatabase()).db;
}
