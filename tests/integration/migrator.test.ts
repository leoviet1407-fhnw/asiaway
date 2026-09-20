import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/server/db/schema';
import { runMigrations } from '../../src/server/db/migrator';
import { MIGRATION_FILES, type AppDatabase } from '../../src/server/db/client';

/**
 * The migrator runs against an EMPTY database, which is exactly the state a
 * freshly provisioned managed Postgres is in.
 */
let client: PGlite | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
});

async function freshDatabase(): Promise<{ db: AppDatabase; exec: (t: string) => Promise<unknown> }> {
  client = new PGlite();
  return {
    db: drizzle(client, { schema }) as unknown as AppDatabase,
    exec: (text: string) => client!.exec(text),
  };
}

describe('running migrations against a live database', () => {
  it('builds the whole schema from nothing', async () => {
    const { db, exec } = await freshDatabase();
    const result = await runMigrations(db, exec);

    expect(result.applied).toEqual([...MIGRATION_FILES]);
    expect(result.alreadyApplied).toEqual([]);

    const tables = await db.execute(
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
    );
    const n = ((tables as any).rows ?? tables)[0].n;
    // 16 domain tables + auth_sessions + login_attempts + the ledger.
    expect(n).toBeGreaterThanOrEqual(19);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const { db, exec } = await freshDatabase();
    await runMigrations(db, exec);
    const second = await runMigrations(db, exec);

    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual([...MIGRATION_FILES]);
  });

  it('records what it applied, so a later migration can be added safely', async () => {
    const { db, exec } = await freshDatabase();
    await runMigrations(db, exec);

    const rows = await db.execute(sql`select filename from schema_migrations order by filename`);
    const files = ((rows as any).rows ?? rows).map((r: { filename: string }) => r.filename);
    expect(files).toEqual([...MIGRATION_FILES].sort());
  });

  it('leaves the append-only protection in place', async () => {
    const { db, exec } = await freshDatabase();
    await runMigrations(db, exec);

    // The guard is a row-level trigger, so it needs a row to fire on: an UPDATE
    // matching nothing succeeds trivially and would prove nothing.
    await client!.exec(`
      insert into audit_events (actor_type, action, entity_type, entity_id)
      values ('SYSTEM', 'SESSION_OPENED', 'SESSION',
              '11111111-1111-1111-1111-111111111111')
    `);

    await expect(
      client!.exec(`update audit_events set action = 'TAMPERED'`),
    ).rejects.toThrow(/append-only/i);
    await expect(client!.exec('delete from audit_events')).rejects.toThrow(/append-only/i);
  });

  it('produces a schema the application can immediately write to', async () => {
    const { db, exec } = await freshDatabase();
    await runMigrations(db, exec);

    // Order numbers come from a sequence created by the migration.
    const a = await db.execute(sql`select nextval('order_number_seq') as n`);
    const first = Number(((a as any).rows ?? a)[0].n);
    expect(first).toBe(1001);
  });
});
