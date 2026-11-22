import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, gte, lte } from 'drizzle-orm';
import { parseTime, mustReportTimes } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { shifts, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { getPattern, savePattern } from '@/server/services/pattern-service';
import { saveNeeds } from '@/server/services/coverage-service';
import { getWeekView, saveProfile, saveShift } from '@/server/services/roster-service';
import { suggestWeek } from '@/server/services/suggest-service';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;

/** Every staff member sets their own Standardwoche; the planning follows it. */
describe('Standardwoche set by the staff member', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let staff: Principal;
  let other: Principal;
  const now = new Date('2026-11-13T09:00:00Z');
  const week = '2027-06-07'; // a Monday
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    staff = await principal('winti-vn@asiaway.test');
    other = await principal('winti-th@asiaway.test');
    // two people with a Pensum: nobody "reports" any more, they still set a Standardwoche
    for (const p of [staff, other]) await saveProfile(db, planner, p.userId, { site: 'winterthur', employmentType: 'PART_TIME', pensumPercent: 80, active: true });
    expect(mustReportTimes('PART_TIME')).toBe(false);
  }, 60_000);
  afterAll(async () => close());

  it('a staff member with a Pensum saves their own week, but not a colleague’s', async () => {
    const mine = (await getPattern(db, staff, staff.userId)).map((d) =>
      d.weekday === 1 ? { ...d, kind: 'UNAVAILABLE' as const, fromMin: null, toMin: null }
      : d.weekday === 2 ? { ...d, kind: 'AVAILABLE' as const, fromMin: t('17:00'), toMin: t('22:00') }
      : { ...d, kind: 'AVAILABLE' as const, fromMin: null, toMin: null },
    );
    await savePattern(db, staff, staff.userId, mine);
    expect((await getPattern(db, staff, staff.userId)).find((d) => d.weekday === 1)?.kind).toBe('UNAVAILABLE');
    await expect(savePattern(db, staff, other.userId, mine)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the suggestion keeps them free on "Nicht verfügbar" and inside their times', async () => {
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, () => ({ lunchPeople: 2, dinnerPeople: 2 })));
    await suggestWeek(db, planner, 'winterthur', week, now);
    const mine = await db.select().from(shifts).where(and(eq(shifts.userId, staff.userId), gte(shifts.workDate, week), lte(shifts.workDate, '2027-06-13')));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((s) => s.workDate === '2027-06-07')).toBe(false); // Monday: not available
    for (const s of mine.filter((x) => x.workDate === '2027-06-08')) expect(s.startMin).toBeGreaterThanOrEqual(t('17:00')); // Tuesday: from 17:00
  });

  it('a shift on their day off is flagged for the Leitung', async () => {
    await saveShift(db, planner, { site: 'winterthur', date: week, userId: staff.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    const v = await getWeekView(db, planner, 'winterthur', week);
    expect(v.violations.some((x) => x.code === 'UNAVAILABLE' && x.userId === staff.userId)).toBe(true);
  });
});
