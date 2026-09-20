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

/**
 * A connection pooler in transaction mode (PgBouncer, which is what Neon,
 * Supabase and most serverless Postgres put in front of the database) hands a
 * different backend connection to each transaction. Prepared statements are
 * per-connection, so postgres-js's default prepared statements fail against it —
 * usually as a baffling "prepared statement already exists" once traffic picks
 * up rather than immediately.
 *
 * Detected from the connection string rather than configured, because getting
 * this wrong produces an error that only appears under load.
 */
export function isPooledConnection(connectionString: string): boolean {
  return /-pooler\.|pgbouncer=true|\bpool\b/i.test(connectionString);
}

/** Serverless runs many short-lived instances, so each one keeps few connections. */
function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function createPostgresDatabase(connectionString: string) {
  const pooled = isPooledConnection(connectionString);
  const serverless = isServerless();

  const client = postgres(connectionString, {
    // One instance must not hoard the connection budget shared by all of them.
    max: serverless ? 1 : 10,
    prepare: pooled ? false : undefined,
    idle_timeout: serverless ? 10 : undefined,
    connect_timeout: 10,
  });

  return { db: drizzlePostgres(client, { schema }) as unknown as AppDatabase, client };
}

/** Grants (0001) are applied separately in production; see docs/DEPLOYMENT.md. */
export const MIGRATION_FILES = [
  '0000_init.sql',
  '0002_auth_sessions.sql',
  '0003_menu_item_volume.sql',
  '0004_table_area.sql',
  '0005_customer_window.sql',
] as const;
