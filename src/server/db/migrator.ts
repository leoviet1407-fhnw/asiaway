import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { MIGRATION_FILES, type AppDatabase } from './client';

/**
 * Applies the checked-in SQL migrations to a live PostgreSQL database.
 *
 * Two properties make this safe to call from a request handler:
 *
 *  - A `schema_migrations` ledger records what has run, so a second call is a
 *    no-op rather than an error or a duplicate table.
 *  - A session-level advisory lock serialises concurrent callers. On a
 *    serverless host several instances can wake at once, and two processes
 *    running CREATE TABLE against one database is exactly the race that leaves
 *    a half-built schema behind.
 *
 * Migrations stay forward-only and are reviewed like any other code; this only
 * changes WHERE they are applied from, not what they do.
 */
const ADVISORY_LOCK_KEY = 8_273_461_019; // arbitrary, constant for this app

export interface MigrationResult {
  readonly applied: string[];
  readonly alreadyApplied: string[];
}

/**
 * Runs a whole migration file as one unit.
 *
 * A migration file holds many statements, and the extended (prepared-statement)
 * protocol every driver uses by default accepts only one per round trip. So the
 * caller supplies the driver's own raw path — `client.unsafe` for postgres-js,
 * `client.exec` for PGlite — rather than this module guessing which driver it
 * is talking to.
 */
export type ExecuteMultiple = (sqlText: string) => Promise<unknown>;

export async function runMigrations(
  db: AppDatabase,
  executeMultiple: ExecuteMultiple,
  migrationsDir = join(process.cwd(), 'migrations'),
): Promise<MigrationResult> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);

  try {
    const done = await db.execute(sql`SELECT filename FROM schema_migrations`);
    const rows = (done as unknown as { rows?: { filename: string }[] }).rows ?? (done as any);
    const already = new Set<string>(
      (Array.isArray(rows) ? rows : []).map((r: { filename: string }) => r.filename),
    );

    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const file of MIGRATION_FILES) {
      if (already.has(file)) {
        alreadyApplied.push(file);
        continue;
      }

      const statements = readFileSync(join(migrationsDir, file), 'utf8');
      // A failure here leaves the ledger untouched, so the next attempt retries
      // this file rather than skipping a half-applied one.
      await executeMultiple(statements);
      await db.execute(sql`INSERT INTO schema_migrations (filename) VALUES (${file})`);
      applied.push(file);
    }

    return { applied, alreadyApplied };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
  }
}
