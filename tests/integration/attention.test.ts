import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseTime } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { getPlannerTodos } from '@/server/services/attention-service';
import { requestAbsence, saveProfile, saveShift, publishWeek } from '@/server/services/roster-service';
import { saveNeeds } from '@/server/services/coverage-service';
import { getMonthHours, approveMonth } from '@/server/services/hours-service';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;

describe('what the Leitung still has to do', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let staff: Principal;
  let casual: Principal;
  const now = new Date('2026-11-13T09:00:00Z');
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    staff = await principal('winti-vn@asiaway.test');
    casual = await principal('aushilfe@asiaway.test');
    await saveProfile(db, planner, staff.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
  }, 60_000);
  afterAll(async () => close());

  it('lists missing reports, empty weeks, holiday requests and unpublished weeks', async () => {
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, () => ({ lunchPeople: 1, dinnerPeople: 1 })));
    await requestAbsence(db, staff, { userId: staff.userId, startDate: '2026-12-21', endDate: '2026-12-23', type: 'VACATION', note: null }, now);
    const todos = await getPlannerTodos(db, planner, now);
    const by = (key: string) => todos.filter((x) => x.key === key);
    expect(by('HOLIDAY')[0]).toMatchObject({ count: 1 });
    expect(by('REPORTS').some((x) => x.detail.includes('Aushilfe Muster'))).toBe(true); // the casual person has not reported
    expect(by('UNPLANNED')[0]!.count).toBe(4); // four weeks ahead, nothing planned yet
    await saveShift(db, planner, { site: 'winterthur', date: '2026-11-17', userId: staff.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    const after = await getPlannerTodos(db, planner, now);
    expect(after.filter((x) => x.key === 'UNPUBLISHED' && x.site === 'winterthur')[0]!.count).toBe(1);
    expect(after.some((x) => x.key === 'GAPS')).toBe(true); // lunch has someone, dinner is empty
    await expect(getPlannerTodos(db, staff, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('hours of past published shifts are recorded by themselves, and last month still needs approval', async () => {
    await saveShift(db, planner, { site: 'winterthur', date: '2026-10-20', userId: staff.userId, startMin: t('17:30'), endMin: t('22:00'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    await publishWeek(db, planner, 'winterthur', '2026-10-19', now);
    expect((await getPlannerTodos(db, planner, now)).some((x) => x.key === 'APPROVE' && x.detail.includes('Mitarbeiter Winti VN'))).toBe(true);
    const oct = await getMonthHours(db, staff, staff.userId, '2026-10', now);
    expect(oct.entries).toHaveLength(1);
    expect(oct.totals.workedMinutes).toBe(270);
    await approveMonth(db, planner, staff.userId, '2026-10', now);
    expect((await getPlannerTodos(db, planner, now)).some((x) => x.key === 'APPROVE')).toBe(false);
    void casual;
  });
});
