/**
 * Creates ONE test employee (100% contract) and opens the month for
 * availability, on whatever database DATABASE_URL points to. Touches nothing else.
 *
 *   DATABASE_URL='postgres://...' npm run test-login:create -- --password 'choose-one'
 *
 * Optional: --email test.employee@asiaway.test  --month 2026-10
 * The password is chosen by you and is never stored or printed in plaintext.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createPostgresDatabase } from '../src/server/db/client';
import { employments, rosterPeriods, users } from '../src/server/db/schema';
import { hashPassword } from '../src/server/auth/password';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const password = arg('password');
  if (!url || !password) {
    console.error("Usage: DATABASE_URL=... npm run test-login:create -- --password '<password>'");
    process.exitCode = 1;
    return;
  }
  const email = arg('email') ?? 'test.employee@asiaway.test';
  const month = arg('month') ?? '2026-10';
  const [y, m] = month.split('-').map(Number) as [number, number];
  const startsOn = `${month}-01`;
  const endsOn = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const { db, client } = createPostgresDatabase(url);
  const passwordHash = await hashPassword(password);

  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  const userId =
    existing?.id ??
    (await db.insert(users).values({ email, displayName: 'Test Employee', passwordHash, role: 'WAITER' }).returning({ id: users.id }))[0]!.id;
  if (existing) {
    await db.update(users).set({ passwordHash, isActive: true }).where(eq(users.id, userId));
  }

  const [contract] = await db
    .select({ id: employments.id })
    .from(employments)
    .where(and(eq(employments.userId, userId), isNull(employments.validTo)));
  if (!contract) {
    await db.insert(employments).values({ userId, employmentType: 'FULL_TIME', pensumPercent: '100', validFrom: '2026-01-01' });
  }

  const deadline = new Date(Date.now() + 60 * 86_400_000);
  const [period] = await db.select({ id: rosterPeriods.id }).from(rosterPeriods).where(eq(rosterPeriods.startsOn, startsOn));
  if (!period) {
    await db.insert(rosterPeriods).values({ startsOn, endsOn, state: 'AVAILABILITY_OPEN', availabilityDeadline: deadline });
  } else {
    await db.update(rosterPeriods).set({ state: 'AVAILABILITY_OPEN', availabilityDeadline: deadline }).where(eq(rosterPeriods.id, period.id));
  }

  console.log(`Ready: ${email} (100%), ${startsOn} to ${endsOn} open for availability until ${deadline.toISOString()}`);
  await client.end();
}

main().catch((e: unknown) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
