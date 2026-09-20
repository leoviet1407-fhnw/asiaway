import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { schema } from '../../src/server/db/schema';
import { MIGRATION_FILES } from '../../src/server/db/client';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestContext {
  db: TestDb;
  client: PGlite;
  close: () => Promise<void>;
}

/**
 * A fresh in-process PostgreSQL 16 per test file. Real SQL, real triggers, real
 * sequences — the guarantees under test are database behaviour, so mocking the
 * database would prove nothing.
 */
export async function createTestDatabase(): Promise<TestContext> {
  const client = new PGlite();
  // The real migration list, not a copy of it. A hand-maintained list here
  // silently stops testing whatever was added last.
  for (const file of MIGRATION_FILES) {
    await client.exec(readFileSync(resolve(process.cwd(), 'migrations', file), 'utf8'));
  }
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}
