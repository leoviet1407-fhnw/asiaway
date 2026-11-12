import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { schema } from './schema';
import type { AppDatabase } from './client';

/**
 * PGlite: PostgreSQL 16 in WebAssembly, in-process. Tests, CLI scripts and
 * zero-infrastructure local development only — never production.
 */
export function createPgliteDatabase(instance?: PGlite) {
  const client = instance ?? new PGlite();
  return { db: drizzlePglite(client, { schema }) as unknown as AppDatabase, client };
}

export { PGlite };
