import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { schema } from './schema';
import { MIGRATION_FILES, type AppDatabase } from './client';

/**
 * PGlite: real PostgreSQL 16 compiled to WebAssembly, running in-process.
 *
 * Used by the test suite, the CLI scripts and zero-infrastructure local
 * development — never in production, which requires DATABASE_URL.
 *
 * Kept in its own module so that nothing on the production request path
 * statically imports 23 MB of WebAssembly.
 */
export function createPgliteDatabase(instance?: PGlite) {
  const client = instance ?? new PGlite();
  return { db: drizzlePglite(client, { schema }) as unknown as AppDatabase, client };
}

export async function applyMigrations(
  client: PGlite,
  migrationsDir = resolve(process.cwd(), 'migrations'),
): Promise<void> {
  for (const file of MIGRATION_FILES) {
    await client.exec(readFileSync(resolve(migrationsDir, file), 'utf8'));
  }
}

export { PGlite };
