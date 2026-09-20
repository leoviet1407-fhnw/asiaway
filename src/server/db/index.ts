import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPostgresDatabase, type AppDatabase } from './client';

/**
 * The application's database handle.
 *
 * With DATABASE_URL set, this is ordinary PostgreSQL — that is production, and
 * the only path a deployed server ever takes.
 *
 * Without it, development falls back to a file-backed PGlite database that
 * migrates itself on first use, so `npm run dev` works on a laptop with no
 * Docker and no database server. That fallback is imported DYNAMICALLY: a
 * static import would pull 23 MB of WebAssembly into every production bundle
 * and cold start for code that production never runs.
 */
export interface DatabaseHandle {
  readonly db: AppDatabase;
  readonly mode: 'postgres' | 'pglite';
  /** Runs multi-statement SQL through the driver's raw path. See migrator.ts. */
  readonly executeMultiple: (sqlText: string) => Promise<unknown>;
}

const globalRef = globalThis as unknown as { __asiawayDb?: Promise<DatabaseHandle> };

async function create(): Promise<DatabaseHandle> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { db, client } = createPostgresDatabase(url);
    const executeMultiple = (text: string) => client.unsafe(text);

    // Bring the schema up to date before serving anything.
    //
    // This used to be a manual call to /api/admin/setup after each deploy, and
    // on 2026-09-20 that gap took the guest menu down: the code shipped, the
    // migration did not, and every read of a table with a new column failed.
    // A deployment step a person has to remember is not a deployment step.
    //
    // Safe to do here, and what the migrator was built for: the ledger makes a
    // second run a no-op, and the advisory lock serialises the several
    // instances a serverless host can wake at once. The cost is one cheap
    // SELECT per cold start.
    if (process.env.MIGRATE_ON_BOOT !== '0') {
      const { runMigrations } = await import('./migrator');
      await runMigrations(db, executeMultiple);
    }

    return { db, mode: 'postgres', executeMultiple };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production');
  }

  const { PGlite, createPgliteDatabase } = await import('./pglite');
  const { runMigrations } = await import('./migrator');

  // PGLITE_DIR lets a second dev server run against its own database. PGlite is
  // an in-process engine, so two servers sharing one directory each hold their
  // own view of it and neither sees the other's writes.
  const dir = resolve(process.cwd(), process.env.PGLITE_DIR ?? '.pglite');
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(resolve(dir, 'asiaway'));

  const { db } = createPgliteDatabase(client);

  // The same ledger-driven migrator production uses, rather than "create the
  // schema if the orders table is missing". That older check ran once and then
  // never again, so a migration added later was silently skipped locally and
  // the app failed on a column that the code and the tests both had.
  //
  // A local database created by that older bootstrap has the schema but no
  // ledger, and 0000_init is not idempotent — replaying it would fail on
  // half-created types. Say so plainly instead of failing on a missing column
  // several requests later. Production is unaffected: it has always had the
  // ledger, because it has always used this migrator.
  const legacy = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
     where table_name = 'orders'
       and not exists (
         select 1 from information_schema.tables where table_name = 'schema_migrations'
       )`,
  );
  if ((legacy.rows[0]?.n ?? 0) > 0) {
    throw new Error(
      'This local .pglite database predates the migration ledger, so new migrations ' +
        'cannot be applied to it. Delete the .pglite directory and run `npm run seed` ' +
        'to rebuild it. Production databases are not affected.',
    );
  }

  await runMigrations(db, (text) => client.exec(text));

  return { db, mode: 'pglite', executeMultiple: (text) => client.exec(text) };
}

export function getDatabase(): Promise<DatabaseHandle> {
  // A failed attempt must not be cached. Without this, one transient error at
  // boot — a lock held a moment too long, a connection refused — would be
  // remembered as a rejected promise and every later request on this instance
  // would fail with it, long after the cause had gone.
  return (globalRef.__asiawayDb ??= create().catch((error: unknown) => {
    globalRef.__asiawayDb = undefined;
    throw error;
  }));
}

export async function db(): Promise<AppDatabase> {
  return (await getDatabase()).db;
}
