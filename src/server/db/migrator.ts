import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { MIGRATION_FILES, type AppDatabase } from './client';

/**
 * Applies the checked-in SQL migrations to a live PostgreSQL database.
 *
 * Three properties make this safe to call from a request handler:
 *
 *  - A `schema_migrations` ledger records what has run, so a second call is a
 *    no-op rather than an error or a duplicate table. When nothing is pending,
 *    which is nearly every cold start, it takes no lock at all.
 *  - Each pending file goes to the database as ONE message: a transaction-level
 *    advisory lock, its ledger row, then its statements. Postgres runs a
 *    multi-statement message as one implicit transaction on one connection, so
 *    the lock, the row and the schema change commit or roll back together, and
 *    the lock is released by the transaction ending — it cannot be left behind.
 *  - Instances that wake together queue on that lock; the ones that lose find
 *    the ledger row already there and skip the file.
 *
 * The lock used to be session-level, taken and released by separate queries.
 * Behind a transaction-mode pooler (Neon, Supabase) those queries can reach
 * different server connections, so the release missed ("you don't own a lock")
 * and the lock stayed held on a pooled connection. The next instance to wake then
 * waited on it forever, and every request it served hung until the host cut it
 * off — waiter screens and guest menus alike.
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

async function appliedFiles(db: AppDatabase): Promise<Set<string>> {
  const done = await db.execute(sql`SELECT filename FROM schema_migrations`);
  const rows = (done as unknown as { rows?: { filename: string }[] }).rows ?? (done as any);
  return new Set<string>((Array.isArray(rows) ? rows : []).map((r: { filename: string }) => r.filename));
}

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

  const already = await appliedFiles(db);
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const file of MIGRATION_FILES) {
    if (already.has(file)) {
      alreadyApplied.push(file);
      continue;
    }

    const statements = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      // A failure anywhere rolls back the ledger row with the rest, so the next
      // attempt retries this file rather than skipping a half-applied one.
      await executeMultiple(
        `SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY});\n` +
          `INSERT INTO schema_migrations (filename) VALUES ('${file.replaceAll("'", "''")}');\n` +
          statements,
      );
      applied.push(file);
    } catch (error) {
      // Another instance applied this file while we queued for the lock: our
      // ledger insert collided and nothing of ours ran. Anything else is real.
      if ((await appliedFiles(db)).has(file)) {
        alreadyApplied.push(file);
        continue;
      }
      throw error;
    }
  }

  return { applied, alreadyApplied };
}
