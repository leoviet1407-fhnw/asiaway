/**
 * Applies the SQL migrations to the database in DATABASE_URL.
 *
 *   DATABASE_URL=postgres://... npm run db:migrate
 *
 * Forward-only. Migrations are plain SQL files, checked into git and reviewed
 * like any other code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { MIGRATION_FILES } from '../src/server/db/client';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exitCode = 1;
    return;
  }

  const client = postgres(url, { max: 1 });
  try {
    for (const file of MIGRATION_FILES) {
      const sqlText = readFileSync(resolve(process.cwd(), 'migrations', file), 'utf8');
      console.log(`Applying ${file}…`);
      await client.unsafe(sqlText);
    }
    console.log('Migrations applied.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
