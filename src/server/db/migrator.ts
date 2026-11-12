import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { MIGRATION_FILES, type AppDatabase } from './client';

/**
 * Applies pending SQL migrations, recorded in a schema_migrations ledger.
 * Each file goes to the server as ONE message together with a transaction-level
 * advisory lock and its ledger row, so it commits or rolls back as a unit and
 * concurrent instances cannot apply it twice. (Same design as the QR-menu apps.)
 */
const ADVISORY_LOCK_KEY = 5_120_771_338;

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
): Promise<string[]> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
  const already = await appliedFiles(db);
  const applied: string[] = [];
  for (const file of MIGRATION_FILES) {
    if (already.has(file)) continue;
    const statements = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await executeMultiple(
        `SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY});\n` +
          `INSERT INTO schema_migrations (filename) VALUES ('${file.replaceAll("'", "''")}');\n` +
          statements,
      );
      applied.push(file);
    } catch (error) {
      if ((await appliedFiles(db)).has(file)) continue;
      throw error;
    }
  }
  return applied;
}
