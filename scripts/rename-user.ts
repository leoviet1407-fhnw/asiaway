/**
 * Renames a login (name and e-mail) while keeping the account, its roles,
 * profile, shifts and password.
 *
 *   DATABASE_URL=… npm run user:rename -- --from vy@asiaway.ch --email ivy@asiaway.ch --name Ivy
 */
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { users } from '../src/server/db/schema';
import { openCliDatabase } from './cli-db';

const { values } = parseArgs({
  options: { from: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } },
});
const from = values.from?.trim();
const email = values.email?.trim();
const name = values.name?.trim();
if (!from || !email || !name) {
  console.error('Usage: npm run user:rename -- --from old@asiaway.ch --email new@asiaway.ch --name "New Name"');
  process.exit(1);
}

const { db, mode, close } = await openCliDatabase();
try {
  const updated = await db.update(users).set({ email, name }).where(eq(users.email, from)).returning({ id: users.id });
  if (updated.length !== 1) throw new Error(`Expected exactly one user with e-mail ${from}, found ${updated.length}.`);
  console.log(`Renamed ${from} -> ${email} (${name}) on ${mode}.`);
} finally {
  await close();
}
