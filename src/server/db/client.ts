import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { schema } from './schema';

/**
 * Two drivers, one schema.
 *
 * Production runs ordinary PostgreSQL over postgres-js. Tests and zero-infra
 * local development run PGlite, which is real PostgreSQL 16 compiled to WASM —
 * not an emulation — so sequences, triggers, partial indexes and transaction
 * behaviour are exercised for real without requiring Docker.
 */
export type AppDatabase = PgDatabase<any, any, any>;

export function createPgliteDatabase(instance?: PGlite) {
  const client = instance ?? new PGlite();
  return { db: drizzlePglite(client, { schema }) as unknown as AppDatabase, client };
}

export function createPostgresDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  return { db: drizzlePostgres(client, { schema }) as unknown as AppDatabase, client };
}

/** Grants (0001) are production-only: PGlite runs single-user. */
export const MIGRATION_FILES = ['0000_init.sql', '0002_auth_sessions.sql'] as const;

export async function applyMigrations(
  client: PGlite,
  migrationsDir = resolve(process.cwd(), 'migrations'),
): Promise<void> {
  for (const file of MIGRATION_FILES) {
    await client.exec(readFileSync(resolve(migrationsDir, file), 'utf8'));
  }
}
