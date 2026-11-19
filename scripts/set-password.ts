/**
 * Checks a login and (optionally) sets a new password for it.
 *
 *   DATABASE_URL=… npm run user:password -- --email xuan.truong@asiaway.ch            # check only
 *   DATABASE_URL=… SET_PASSWORD='Fluss-Zitrone-23' npm run user:password -- --email xuan.truong@asiaway.ch --set
 *
 * With --set and no SET_PASSWORD, a random password is generated and printed once.
 * Also clears the failed-login lock for that email and re-activates the account.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { eq, ilike, sql } from 'drizzle-orm';
import { hashPassword } from '../src/server/auth/password';
import { loginAttempts, users } from '../src/server/db/schema';
import { openCliDatabase } from './cli-db';

const { values } = parseArgs({ options: { email: { type: 'string' }, set: { type: 'boolean' } } });
const email = values.email?.trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run user:password -- --email name@asiaway.ch [--set]');
  process.exit(1);
}

const { db, mode, close } = await openCliDatabase();
try {
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!user) {
    const local = email.split('@')[0]!.split('.')[0]!;
    const similar = await db.select({ email: users.email, name: users.name }).from(users).where(ilike(users.email, `%${local}%`));
    console.log(`No user with e-mail ${email} on ${mode}.`);
    console.log(similar.length ? `Similar: ${similar.map((u) => `${u.email} (${u.name})`).join(', ')}` : 'No similar e-mails found.');
    process.exitCode = 1;
  } else {
    console.log(`Found ${user.email} (${user.name}) on ${mode}; active=${user.active}.`);
    if (values.set) {
      const generated = !process.env.SET_PASSWORD;
      const password = process.env.SET_PASSWORD || randomBytes(9).toString('base64url');
      await db.update(users).set({ passwordHash: await hashPassword(password), active: true }).where(eq(users.id, user.id));
      await db.delete(loginAttempts).where(eq(loginAttempts.emailLower, email));
      console.log('Password set, account active, failed-login lock cleared.');
      if (generated) console.log(`New password (shown once): ${password}`);
    }
  }
} finally {
  await close();
}
