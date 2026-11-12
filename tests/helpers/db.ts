import { PGlite } from '@electric-sql/pglite';
import { createPgliteDatabase } from '../../src/server/db/pglite';
import { runMigrations } from '../../src/server/db/migrator';
import type { AppDatabase } from '../../src/server/db/client';

/** A fresh in-process PostgreSQL per test file, migrated with the real migrations. */
export async function createTestDatabase(): Promise<{ db: AppDatabase; close: () => Promise<void> }> {
  const client = new PGlite();
  const { db } = createPgliteDatabase(client);
  await runMigrations(db, (text) => client.exec(text));
  return { db, close: () => client.close() };
}
