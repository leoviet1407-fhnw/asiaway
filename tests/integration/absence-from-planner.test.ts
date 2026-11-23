import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { parseTime } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { absences, shifts, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { cancelAbsence, enterAbsence, getWeekView, saveProfile, saveShift } from '@/server/services/roster-service';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;

/** The Leitung enters holidays or sick leave straight from the week planner. */
describe('absence entered from the week planner', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let staff: Principal;
  const monday = new Date('2026-12-07T08:00:00Z'); // the planner works on Monday 7 Dec
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };
  const shift = (date: string, start: string, end: string, now: Date) =>
    saveShift(db, planner, { site: 'winterthur', date, userId: staff.userId, startMin: t(start), endMin: t(end), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    staff = await principal('winti-vn@asiaway.test');
    await saveProfile(db, planner, staff.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
  }, 60_000);
  afterAll(async () => close());

  it('is approved at once and frees the shifts in that time from today on', async () => {
    // planned a week ahead: Mon 7, Tue 8, Wed 9 Dec; and Fri 11 (outside the holidays)
    const before = new Date('2026-11-25T09:00:00Z');
    const mon = await shift('2026-12-07', '10:30', '14:30', before);
    const tue = await shift('2026-12-08', '10:30', '14:30', before);
    const wed = await shift('2026-12-09', '17:30', '22:00', before);
    const fri = await shift('2026-12-11', '10:30', '14:30', before);
    // Monday morning: sick from Monday to Wednesday
    const r = await enterAbsence(db, planner, { userId: staff.userId, startDate: '2026-12-07', endDate: '2026-12-09', type: 'SICK' }, { releaseShifts: true }, monday);
    expect(r.released).toBe(3);
    const [row] = await db.select().from(absences).where(eq(absences.id, r.id));
    expect(row).toMatchObject({ status: 'APPROVED', type: 'SICK' });
    const owner = async (id: string) => (await db.select({ u: shifts.userId }).from(shifts).where(eq(shifts.id, id)))[0]!.u;
    for (const id of [mon, tue, wed]) expect(await owner(id)).toBeNull(); // open shifts now
    expect(await owner(fri)).toBe(staff.userId); // outside the holidays: unchanged
    // the week shows the absence (with its id) and no "planned although away" error
    const view = await getWeekView(db, planner, 'winterthur', '2026-12-07');
    expect(view.absences.find((a) => a.userId === staff.userId)).toMatchObject({ id: r.id, type: 'SICK' });
    expect(view.violations.some((v) => v.code === 'ABSENCE')).toBe(false);
  });

  it('days that are over keep their shifts; without the tick nothing is freed', async () => {
    const before = new Date('2026-11-25T09:00:00Z');
    const fri = await shift('2026-12-18', '10:30', '14:30', before);
    // entered later, for a time that has partly passed: the past shift stays
    const r = await enterAbsence(db, planner, { userId: staff.userId, startDate: '2026-12-14', endDate: '2026-12-18', type: 'VACATION' }, { releaseShifts: false }, new Date('2026-12-16T08:00:00Z'));
    expect(r.released).toBe(0);
    expect((await db.select({ u: shifts.userId }).from(shifts).where(eq(shifts.id, fri)))[0]!.u).toBe(staff.userId);
    const view = await getWeekView(db, planner, 'winterthur', '2026-12-14');
    expect(view.violations.some((v) => v.code === 'ABSENCE' && v.userId === staff.userId)).toBe(true); // the Leitung sees the clash
  });

  it('only the Leitung enters it; the Leitung can delete it again', async () => {
    await expect(enterAbsence(db, staff, { userId: staff.userId, startDate: '2027-01-04', endDate: '2027-01-08', type: 'VACATION' }, { releaseShifts: true }, monday)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = await enterAbsence(db, planner, { userId: staff.userId, startDate: '2027-01-04', endDate: '2027-01-08', type: 'VACATION' }, { releaseShifts: true }, monday);
    await cancelAbsence(db, planner, r.id);
    expect(await db.select().from(absences).where(and(eq(absences.id, r.id)))).toHaveLength(0);
  });
});
