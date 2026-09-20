import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { schema } from './schema';

/**
 * The production database handle: ordinary PostgreSQL over postgres-js.
 *
 * PGlite deliberately lives in ./pglite and is NOT imported from here. It is
 * 23 MB of WebAssembly, and a static import would drag it into every serverless
 * bundle and every cold start of a deployment that will never use it.
 */
export type AppDatabase = PgDatabase<any, any, any>;

export function createPostgresDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  return { db: drizzlePostgres(client, { schema }) as unknown as AppDatabase, client };
}

/** Grants (0001) are applied separately in production; see docs/DEPLOYMENT.md. */
export const MIGRATION_FILES = ['0000_init.sql', '0002_auth_sessions.sql'] as const;
