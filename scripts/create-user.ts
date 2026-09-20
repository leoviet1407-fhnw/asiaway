/**
 * Creates or updates a waiter account.
 *
 *   npm run user:create -- --email anna@asiaway.ch --name "Anna" --password '...'
 *
 * Passwords are hashed with Argon2id and never stored or logged in plaintext.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresDatabase, type AppDatabase } from '../src/server/db/client';
import { createPgliteDatabase } from '../src/server/db/pglite';
import { users } from '../src/server/db/schema';
import { hashPassword } from '../src/server/auth/password';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const direct = process.argv.find((a) => a.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email');
  const name = arg('name');
  const password = arg('password') ?? process.env.NEW_USER_PASSWORD;

  if (!email || !name || !password) {
    console.error('Usage: npm run user:create -- --email <email> --name <name> --password <password>');
    process.exitCode = 1;
    return;
  }

  const url = process.env.DATABASE_URL;
  let db: AppDatabase;
  let close: () => Promise<void> = async () => {};

  if (url) {
    const created = createPostgresDatabase(url);
    db = created.db;
    close = async () => {
      await created.client.end();
    };
  } else {
    mkdirSync(resolve(process.cwd(), '.pglite'), { recursive: true });
    const client = new PGlite(resolve(process.cwd(), '.pglite/asiaway'));
    db = createPgliteDatabase(client).db;
    close = async () => client.close();
  }

  const passwordHash = await hashPassword(password);
  const existing = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);

  if (existing[0]) {
    await db.update(users).set({ passwordHash, displayName: name, isActive: true }).where(sql`${users.id} = ${existing[0].id}`);
    console.log(`Updated ${email}`);
  } else {
    await db.insert(users).values({ email, displayName: name, passwordHash, role: 'WAITER' });
    console.log(`Created ${email}`);
  }

  await close();
}

main().catch((error: unknown) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
