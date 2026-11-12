import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPostgresDatabase, type AppDatabase } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrator';

/**
 * Opens the same database the app uses: DATABASE_URL if set, otherwise the
 * local PGlite under .pglite/ (stop `npm run dev` first — PGlite allows one
 * process at a time).
 */
export async function openCliDatabase(): Promise<{ db: AppDatabase; mode: 'postgres' | 'pglite'; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { db, client } = createPostgresDatabase(url);
    await runMigrations(db, (text) => client.unsafe(text));
    return { db, mode: 'postgres', close: () => client.end() };
  }
  const { PGlite, createPgliteDatabase } = await import('../src/server/db/pglite');
  const dir = resolve(process.cwd(), process.env.PGLITE_DIR ?? '.pglite');
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(resolve(dir, 'staff'));
  const { db } = createPgliteDatabase(client);
  await runMigrations(db, (text) => client.exec(text));
  return { db, mode: 'pglite', close: () => client.close() };
}
