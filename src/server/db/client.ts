import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { schema } from './schema';

/**
 * Production handle: PostgreSQL over postgres-js. PGlite lives in ./pglite and
 * is never imported from here, so it stays out of production bundles.
 */
export type AppDatabase = PgDatabase<any, typeof schema, any>;

/** Transaction-mode poolers (Neon, Supabase) cannot use prepared statements. */
export function isPooledConnection(connectionString: string): boolean {
  return /-pooler\.|pgbouncer=true|\bpool\b/i.test(connectionString);
}

export function createPostgresDatabase(connectionString: string) {
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const client = postgres(connectionString, {
    max: serverless ? 1 : 10,
    prepare: isPooledConnection(connectionString) ? false : undefined,
    idle_timeout: serverless ? 10 : undefined,
    connect_timeout: 10,
  });
  return { db: drizzlePostgres(client, { schema }) as unknown as AppDatabase, client };
}

/** Applied in this order; each file runs once (see migrator.ts). */
export const MIGRATION_FILES = ['0000_init.sql', '0001_closings.sql', '0002_roster.sql', '0003_hours.sql', '0004_order_sites.sql', '0005_order_layout.sql', '0006_staffing_needs.sql', '0007_extra_sites.sql', '0008_planner_and_changes.sql'] as const;
