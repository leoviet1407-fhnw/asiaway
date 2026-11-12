import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPostgresDatabase, type AppDatabase } from './client';

/**
 * The application's database.
 *
 * DATABASE_URL set → PostgreSQL (production), migrated on first use.
 * Not set (development only) → a file-backed PGlite under .pglite/, migrated
 * and filled with SAMPLE data on first use, so `npm run dev` needs nothing else.
 */
export interface DatabaseHandle {
  readonly db: AppDatabase;
  readonly mode: 'postgres' | 'pglite';
}

const globalRef = globalThis as unknown as { __asiawayStaffDb?: Promise<DatabaseHandle> };

async function create(): Promise<DatabaseHandle> {
  const url = process.env.DATABASE_URL;
  const { runMigrations } = await import('./migrator');

  if (url) {
    const { db, client } = createPostgresDatabase(url);
    if (process.env.MIGRATE_ON_BOOT !== '0') await runMigrations(db, (text) => client.unsafe(text));
    return { db, mode: 'postgres' };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }

  const { PGlite, createPgliteDatabase } = await import('./pglite');
  const dir = resolve(process.cwd(), process.env.PGLITE_DIR ?? '.pglite');
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(resolve(dir, 'staff'));
  const { db } = createPgliteDatabase(client);
  await runMigrations(db, (text) => client.exec(text));

  if (process.env.AUTO_SEED !== '0') {
    const { seedIfEmpty } = await import('../seed/sample-data');
    const seeded = await seedIfEmpty(db);
    if (seeded) console.info('[seed] local database filled with SAMPLE data — see README for logins');
  }
  return { db, mode: 'pglite' };
}

export function getDatabase(): Promise<DatabaseHandle> {
  return (globalRef.__asiawayStaffDb ??= create().catch((error: unknown) => {
    globalRef.__asiawayStaffDb = undefined;
    throw error;
  }));
}

export async function db(): Promise<AppDatabase> {
  return (await getDatabase()).db;
}
