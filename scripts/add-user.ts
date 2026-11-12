/**
 * Creates a personal login.
 *
 *   npm run user:add -- --email anna@asiaway.ch --name "Anna" --role STAFF --location oerlikon
 *   npm run user:add -- --email chef@asiaway.ch --name "Chef" --role ORDERER
 *
 * The password is read from the ADD_USER_PASSWORD environment variable, or a
 * random one is generated and printed once. Several --role/--location pairs
 * may be given (STAFF needs a location; ORDERER and ADMIN cover all).
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { hashPassword } from '../src/server/auth/password';
import { locations, userRoles, users } from '../src/server/db/schema';
import { openCliDatabase } from './cli-db';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', multiple: true },
    location: { type: 'string', multiple: true },
  },
});

const email = values.email?.trim();
const name = values.name?.trim();
const roles = values.role ?? [];
if (!email || !name || roles.length === 0) {
  console.error('Usage: npm run user:add -- --email … --name … --role STAFF|ORDERER|ADMIN [--location oerlikon|winti-vn|winti-th]');
  process.exit(1);
}

const { db, close } = await openCliDatabase();
try {
  const known = new Set((await db.select().from(locations)).map((l) => l.id));
  const grants = roles.map((role, i) => {
    const r = role.toUpperCase();
    if (r !== 'STAFF' && r !== 'ORDERER' && r !== 'ADMIN') throw new Error(`Unknown role ${role}`);
    const loc = r === 'STAFF' ? values.location?.[i] ?? values.location?.[0] : null;
    if (r === 'STAFF' && (!loc || !known.has(loc))) throw new Error(`STAFF needs --location (one of ${[...known].join(', ')})`);
    return { role: r as 'STAFF' | 'ORDERER' | 'ADMIN', locationId: loc ?? null };
  });
  const generated = !process.env.ADD_USER_PASSWORD;
  const password = process.env.ADD_USER_PASSWORD || randomBytes(9).toString('base64url');
  const [user] = await db.insert(users).values({ email, name, passwordHash: await hashPassword(password) }).returning({ id: users.id });
  await db.insert(userRoles).values(grants.map((g) => ({ ...g, userId: user!.id })));
  console.log(`Created ${email} with ${grants.map((g) => g.role + (g.locationId ? `@${g.locationId}` : '')).join(', ')}.`);
  if (generated) console.log(`Initial password (shown once): ${password}`);
} finally {
  await close();
}
