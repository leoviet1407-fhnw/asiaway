import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseTime } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { saveClosing } from '@/server/services/closing-service';
import { getOverview } from '@/server/services/overview-service';
import { saveShift } from '@/server/services/roster-service';
import { createTestDatabase } from '../helpers/db';

describe('overview', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let staff: Principal;
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };
  const now = new Date('2026-11-13T09:00:00Z');

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    staff = await principal('winti-vn@asiaway.test');
    const t = (s: string) => parseTime(s)!;
    await saveShift(db, planner, { site: 'winterthur', date: '2026-11-10', userId: staff.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    await saveShift(db, planner, { site: 'winterthur', date: '2026-11-10', userId: staff.userId, startMin: t('17:00'), endMin: t('22:00'), breakMin: 30, station: '1. OG', roleLabel: null }, now);
    await saveClosing(db, staff, { locationId: 'winti-vn', businessDate: '2026-11-12', station: '1. OG', cashCountedCents: 72800, startFloatCents: 30000, eftCents: 226725, mobileCents: 0, posGrossCents: 258460, note: null }, now);
  });
  afterAll(async () => close());

  it('lists the whole team with roles, hours, holidays and overtime', async () => {
    const o = await getOverview(db, planner, { month: '2026-11', weekStart: '2026-11-09', today: '2026-11-13' });
    const row = o.staff.find((r) => r.userId === staff.userId)!;
    expect(o.staff.length).toBeGreaterThanOrEqual(4);
    expect(row).toMatchObject({ site: 'winterthur', siteName: 'Winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
    expect(row.roles).toContain('STAFF');
    expect(row.plannedMinutes).toBe(240 + 270);
    expect(row.targetMinutes).toBeGreaterThan(10000);
    expect(row.vacation).toMatchObject({ entitlement: 25, remaining: 25 });
    expect(o.staff.find((r) => r.employmentType === 'ON_CALL')!.targetMinutes).toBeNull();
  });

  it('shows staffing per day of a week and sales of the last 30 days', async () => {
    const o = await getOverview(db, planner, { month: '2026-11', weekStart: '2026-11-09', today: '2026-11-13' });
    const tue = o.week.days.find((d) => d.date === '2026-11-10')!;
    expect(tue).toMatchObject({ people: 1, shifts: 2 });
    expect(tue.hours).toBeCloseTo(8.5, 5);
    expect(o.week.days).toHaveLength(7);
    expect(o.sales.days).toHaveLength(30);
    expect(o.sales.closings).toBe(1);
    expect(o.sales.totalCents).toBe(258460);
    expect(o.sales.tipsCents).toBe(11065);
    expect(o.sales.averageCents).toBe(258460);
  });

  it('can be limited to a site, and is for the Leitung only', async () => {
    const oer = await getOverview(db, planner, { month: '2026-11', weekStart: '2026-11-09', siteId: 'oerlikon', today: '2026-11-13' });
    expect(oer.staff.every((r) => r.site === 'oerlikon')).toBe(true);
    expect(oer.sales.closings).toBe(0);
    await expect(getOverview(db, staff, { month: '2026-11', weekStart: '2026-11-09', today: '2026-11-13' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
