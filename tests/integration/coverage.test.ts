import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseTime } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { deriveNeedsFromWeek, getCoverage, getNeeds, saveNeeds } from '@/server/services/coverage-service';
import { requestAbsence, saveShift, setAvailability } from '@/server/services/roster-service';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;
const WEEK = '2026-12-14';

describe('staffing need and coverage', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let vn: Principal;
  let th: Principal;
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };
  const now = new Date('2026-11-13T09:00:00Z');

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    vn = await principal('winti-vn@asiaway.test');
    th = await principal('winti-th@asiaway.test');
  });
  afterAll(async () => close());

  it('saves the need per weekday and rejects nonsense; only the Leitung', async () => {
    expect((await getNeeds(db, planner, 'winterthur'))[0]).toEqual({ lunchPeople: 0, dinnerPeople: 0 });
    const needs = Array.from({ length: 7 }, () => ({ lunchPeople: 2, dinnerPeople: 3 }));
    await saveNeeds(db, planner, 'winterthur', needs);
    expect((await getNeeds(db, planner, 'winterthur'))[6]).toEqual({ lunchPeople: 2, dinnerPeople: 3 });
    await expect(saveNeeds(db, planner, 'winterthur', needs.slice(0, 6))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(saveNeeds(db, planner, 'winterthur', needs.map(() => ({ lunchPeople: -1, dinnerPeople: 0 })))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(saveNeeds(db, vn, 'winterthur', needs)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getCoverage(db, vn, 'winterthur', WEEK)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('counts the people who offered each service, minus anyone on holiday', async () => {
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, () => ({ lunchPeople: 2, dinnerPeople: 1 })));
    // Monday: VN offers the whole day, TH only the evening
    await setAvailability(db, planner, { userId: vn.userId, date: '2026-12-14', kind: 'AVAILABLE', fromMin: null, toMin: null }, now);
    await setAvailability(db, planner, { userId: th.userId, date: '2026-12-14', kind: 'AVAILABLE', fromMin: t('17:30'), toMin: t('22:00') }, now);
    // Tuesday: both offer the whole day, but TH is on approved holiday
    await setAvailability(db, planner, { userId: vn.userId, date: '2026-12-15', kind: 'AVAILABLE', fromMin: null, toMin: null }, now);
    await setAvailability(db, planner, { userId: th.userId, date: '2026-12-15', kind: 'AVAILABLE', fromMin: null, toMin: null }, now);
    await requestAbsence(db, planner, { userId: th.userId, startDate: '2026-12-15', endDate: '2026-12-15', type: 'VACATION', note: null }, now);

    const c = await getCoverage(db, planner, 'winterthur', WEEK);
    const [mon, tue, wed] = c.days;
    expect(mon).toMatchObject({ offeredLunch: 1, offeredDinner: 2, need: { lunchPeople: 2, dinnerPeople: 1 } });
    expect(tue).toMatchObject({ offeredLunch: 1, offeredDinner: 1 });
    expect(wed).toMatchObject({ offeredLunch: 0, offeredDinner: 0 });
    // Hours offered: Mon 8.4 + 4.5, Tue 8.4 (TH's holiday day does not count)
    expect(c.totals.offeredHours).toBeCloseTo(8.4 + 4.5 + 8.4, 5);
    expect(c.totals.needHours).toBe(7 * (2 * 4 + 1 * 4.5));
    expect(c.totals.contractHours).toBeCloseTo(42 + 33.6 + 0 + 0, 1); // VN 100 %, TH 80 %, casual and management none
    expect(c.silent).toContain('Aushilfe Muster');
  });

  it('takes the need from a planned week', async () => {
    await saveShift(db, planner, { site: 'winterthur', date: '2026-12-16', userId: vn.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    await saveShift(db, planner, { site: 'winterthur', date: '2026-12-16', userId: th.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: '1. OG', roleLabel: null }, now);
    await saveShift(db, planner, { site: 'winterthur', date: '2026-12-16', userId: vn.userId, startMin: t('17:30'), endMin: t('22:00'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    const derived = await deriveNeedsFromWeek(db, planner, 'winterthur', WEEK);
    expect(derived[2]).toEqual({ lunchPeople: 2, dinnerPeople: 1 });
    expect(derived[0]).toEqual({ lunchPeople: 0, dinnerPeople: 0 });
    expect((await getNeeds(db, planner, 'winterthur'))[2]).toEqual({ lunchPeople: 2, dinnerPeople: 1 });
  });
});
