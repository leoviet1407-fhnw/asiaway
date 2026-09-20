/**
 * Seeds the service team and a month that is collecting availability.
 *
 *   npm run workforce:seed
 *
 * The people, pensum percentages and contract types are those on
 * `Arbeitsplan-Asiaway-07.09.-23.09.26 - Staff.pdf`, so the screens can be
 * exercised against the real team rather than against invented names.
 *
 * Idempotent: run it as often as you like. Every account gets the same
 * development password, which is why this refuses to run against production.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresDatabase, type AppDatabase } from '../src/server/db/client';
import { createPgliteDatabase } from '../src/server/db/pglite';
import { employments, rosterPeriods, shiftTemplates, stations, users } from '../src/server/db/schema';
import { hashPassword } from '../src/server/auth/password';
import { runMigrations } from '../src/server/db/migrator';

const DEV_PASSWORD = 'asiaway-dev-password';

type Person = {
  name: string;
  role: 'WAITER' | 'MANAGER' | 'STAFF';
  type: 'FULL_TIME' | 'PART_TIME' | 'ON_CALL';
  pensum: number | null;
};

const TEAM: Person[] = [
  { name: 'Xuan', role: 'MANAGER', type: 'FULL_TIME', pensum: 100 },
  { name: 'April', role: 'WAITER', type: 'FULL_TIME', pensum: 100 },
  { name: 'Mersi', role: 'WAITER', type: 'FULL_TIME', pensum: 100 },
  { name: 'Edmond', role: 'WAITER', type: 'FULL_TIME', pensum: 100 },
  { name: 'Tamie', role: 'WAITER', type: 'PART_TIME', pensum: 80 },
  { name: 'Phuoc', role: 'WAITER', type: 'PART_TIME', pensum: 80 },
  { name: 'Yen', role: 'WAITER', type: 'PART_TIME', pensum: 70 },
  { name: 'Jenny', role: 'WAITER', type: 'ON_CALL', pensum: null },
  { name: 'Patricia', role: 'WAITER', type: 'ON_CALL', pensum: null },
  { name: 'Dennis', role: 'WAITER', type: 'ON_CALL', pensum: null },
];

/**
 * The weekly skeleton, from the bands on the September 2026 Arbeitsplan.
 *
 * Two departures from that document, both deliberate:
 *  - every band has a real end time, 22:00, in place of the literal "END";
 *  - the two *** NEW *** cleaning duties get a band of their own. On the PDF
 *    they were written into the lunch column against people already fully
 *    occupied, so the work had no time to happen in.
 *
 * Weekdays are ISO: 1 = Monday .. 7 = Sunday.
 */
const TEMPLATES: {
  station: string;
  weekdays: number[];
  from: string;
  to: string;
  headcount?: number;
  role?: string;
  breakMinutes?: number;
  policy?: 'STAFFED' | 'SELF_SERVE' | 'CLOSED';
}[] = [
  { station: 'EG_ALACARTE', weekdays: [1, 2, 3, 4, 5, 6], from: '10:30', to: '14:30', headcount: 2 },
  { station: 'EG_ALACARTE', weekdays: [1, 2, 3, 4, 5, 6], from: '17:30', to: '22:00', headcount: 2 },
  { station: 'EG_ALACARTE', weekdays: [7], from: '11:00', to: '16:00' },
  { station: 'EG_ALACARTE', weekdays: [7], from: '16:00', to: '22:00' },
  { station: 'EG_BUBBLE_TEA', weekdays: [1, 2, 3, 4, 5, 6], from: '14:00', to: '18:00' },
  { station: 'BUFFET', weekdays: [1, 2, 3, 4, 5], from: '10:30', to: '14:30' },
  { station: 'OG_ALACARTE', weekdays: [1, 2, 3, 4, 5, 6], from: '17:30', to: '22:00' },
  { station: 'FOODPASS', weekdays: [1, 2, 3, 4, 5, 6], from: '11:30', to: '14:00', policy: 'SELF_SERVE' },
  { station: 'FOODPASS', weekdays: [1, 2, 3, 4, 5, 6], from: '18:00', to: '22:00', role: 'Foodrunner' },
  { station: 'CLEANING', weekdays: [1, 2, 3, 4, 5], from: '14:30', to: '15:15', role: 'Buffetbereich' },
  { station: 'CLEANING', weekdays: [6, 7], from: '21:30', to: '22:00', role: 'Reiskocher' },
  { station: 'OFFICE', weekdays: [1], from: '10:30', to: '14:00' },
  { station: 'OFFICE', weekdays: [1], from: '14:30', to: '19:00' },
];

/** The next month the restaurant would be planning. */
const PERIOD = { startsOn: '2026-10-01', endsOn: '2026-10-31', deadline: '2026-09-25T22:00:00Z' };

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url && process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed development accounts into production.');
    process.exitCode = 1;
    return;
  }

  let db: AppDatabase;
  let close: () => Promise<void> = async () => {};
  let executeMultiple: (text: string) => Promise<unknown>;

  if (url) {
    const created = createPostgresDatabase(url);
    db = created.db;
    executeMultiple = (text) => created.client.unsafe(text);
    close = async () => {
      await created.client.end();
    };
  } else {
    const dir = resolve(process.cwd(), process.env.PGLITE_DIR ?? '.pglite');
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(resolve(dir, 'asiaway'));
    db = createPgliteDatabase(client).db;
    executeMultiple = (text) => client.exec(text);
    close = async () => client.close();
  }

  // The same ledger-driven migrator the app uses. Seeding a development
  // database that predates the roles in 0007 would otherwise fail on the
  // MANAGER enum value with nothing to suggest what to do about it.
  const migrated = await runMigrations(db, executeMultiple);
  if (migrated.applied.length > 0) {
    console.log(`Applied ${migrated.applied.length} migration(s): ${migrated.applied.join(', ')}\n`);
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);

  for (const person of TEAM) {
    const email = `${person.name.toLowerCase()}@asiaway.test`;
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`);

    const userId =
      existing?.id ??
      (
        await db
          .insert(users)
          .values({ email, displayName: person.name, passwordHash, role: person.role })
          .returning({ id: users.id })
      )[0]!.id;

    if (existing) {
      await db
        .update(users)
        .set({ passwordHash, displayName: person.name, role: person.role, isActive: true })
        .where(eq(users.id, userId));
    }

    const [contract] = await db
      .select({ id: employments.id })
      .from(employments)
      .where(and(eq(employments.userId, userId), isNull(employments.validTo)));

    if (!contract) {
      await db.insert(employments).values({
        userId,
        employmentType: person.type,
        pensumPercent: person.pensum === null ? null : String(person.pensum),
        validFrom: '2026-01-01',
      });
    }

    console.log(
      `${person.name.padEnd(9)} ${person.role.padEnd(8)} ${person.type.padEnd(10)} ` +
        `${person.pensum === null ? 'Aushilfe' : `${person.pensum}%`}`,
    );
  }

  const [period] = await db
    .select({ id: rosterPeriods.id })
    .from(rosterPeriods)
    .where(eq(rosterPeriods.startsOn, PERIOD.startsOn));

  if (!period) {
    await db.insert(rosterPeriods).values({
      startsOn: PERIOD.startsOn,
      endsOn: PERIOD.endsOn,
      state: 'AVAILABILITY_OPEN',
      availabilityDeadline: new Date(PERIOD.deadline),
    });
  } else {
    await db
      .update(rosterPeriods)
      .set({ state: 'AVAILABILITY_OPEN', availabilityDeadline: new Date(PERIOD.deadline) })
      .where(eq(rosterPeriods.id, period.id));
  }

  const stationRows = await db.select({ id: stations.id, code: stations.code }).from(stations);
  const stationId = new Map(stationRows.map((s) => [s.code, s.id]));
  const [anyTemplate] = await db.select({ id: shiftTemplates.id }).from(shiftTemplates).limit(1);

  if (!anyTemplate) {
    const rows = TEMPLATES.flatMap((t) =>
      t.weekdays.map((weekday) => ({
        stationId: stationId.get(t.station)!,
        weekday,
        startsAt: t.from,
        endsAt: t.to,
        headcount: t.headcount ?? 1,
        roleLabel: t.role ?? null,
        breakMinutes: t.breakMinutes ?? 0,
        staffingPolicy: t.policy ?? null,
        effectiveFrom: '2026-01-01',
      })),
    );
    await db.insert(shiftTemplates).values(rows);
    console.log(`\n${rows.length} shift templates seeded.`);
  }

  console.log(`\nOctober 2026 is open for availability until ${PERIOD.deadline}.`);
  console.log(`Sign in at /waiter/login as <name>@asiaway.test with: ${DEV_PASSWORD}`);

  await close();
}

main().catch((error: unknown) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
