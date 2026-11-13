import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseTime } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import { isPlanner } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { shifts, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { decideChangeRequest, listChangeRequests, requestChange, withdrawChangeRequest } from '@/server/services/change-request-service';
import { getMonthHours } from '@/server/services/hours-service';
import { publishWeek, saveProfile, saveShift } from '@/server/services/roster-service';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;
/** These past shifts were planned weeks ahead (the current week is frozen now). */
const early = new Date('2026-10-01T09:00:00Z');

describe('change requests', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let staff: Principal;
  let other: Principal;
  const now = new Date('2026-11-12T12:00:00Z');
  let futureShift = '';
  let pastShift = '';

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
    await saveProfile(db, planner, staff.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
    pastShift = await saveShift(db, planner, { site: 'winterthur', date: '2026-11-10', userId: staff.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, early);
    futureShift = await saveShift(db, planner, { site: 'winterthur', date: '2026-11-17', userId: staff.userId, startMin: t('17:30'), endMin: t('22:00'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    await publishWeek(db, planner, 'winterthur', '2026-11-09', early);
    await publishWeek(db, planner, 'winterthur', '2026-11-16', now);
  }, 60_000);
  afterAll(async () => close());

  it('only planners (PLANNER or ADMIN) make the roster', async () => {
    expect(isPlanner(planner)).toBe(true);
    expect(isPlanner(staff)).toBe(false);
    await expect(saveShift(db, staff, { site: 'winterthur', date: '2026-11-18', userId: staff.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a request needs a reason and an own, published shift', async () => {
    await expect(requestChange(db, staff, { kind: 'SHIFT_CANCEL', shiftId: futureShift, reason: ' ' }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(requestChange(db, other, { kind: 'SHIFT_CANCEL', shiftId: futureShift, reason: 'krank' }, now)).rejects.toThrow();
    await expect(requestChange(db, staff, { kind: 'SHIFT_CANCEL', shiftId: pastShift, reason: 'krank' }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('a changed time is applied only after the Leitung approves', async () => {
    const id = await requestChange(db, staff, { kind: 'SHIFT_CHANGE', shiftId: futureShift, startMin: t('18:30'), endMin: t('22:00'), reason: 'Schule bis 18:00' }, now);
    await expect(requestChange(db, staff, { kind: 'SHIFT_CANCEL', shiftId: futureShift, reason: 'nochmals' }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await listChangeRequests(db, staff)).map((r) => r.id)).toContain(id);
    expect(await listChangeRequests(db, other)).toHaveLength(0);
    const [before] = await db.select().from(shifts).where(eq(shifts.id, futureShift));
    expect(before!.startMin).toBe(t('17:30'));
    await expect(decideChangeRequest(db, staff, id, true, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await decideChangeRequest(db, planner, id, true, now);
    const [after] = await db.select().from(shifts).where(eq(shifts.id, futureShift));
    expect(after!.startMin).toBe(t('18:30'));
    await expect(decideChangeRequest(db, planner, id, false, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('cancelling an approved shift leaves it open in the plan; rejecting changes nothing; staff can withdraw', async () => {
    const id = await requestChange(db, staff, { kind: 'SHIFT_CANCEL', shiftId: futureShift, reason: 'Arzttermin' }, now);
    await decideChangeRequest(db, planner, id, false, now);
    expect((await db.select().from(shifts).where(eq(shifts.id, futureShift)))[0]!.userId).toBe(staff.userId);
    const id2 = await requestChange(db, staff, { kind: 'SHIFT_CANCEL', shiftId: futureShift, reason: 'Arzttermin' }, now);
    await expect(withdrawChangeRequest(db, other, id2)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await withdrawChangeRequest(db, staff, id2);
    const id3 = await requestChange(db, staff, { kind: 'SHIFT_CANCEL', shiftId: futureShift, reason: 'krank' }, now);
    await decideChangeRequest(db, planner, id3, true, now);
    expect((await db.select().from(shifts).where(eq(shifts.id, futureShift)))[0]!.userId).toBeNull();
  });

  it('worked time differing from the plan is recorded once approved', async () => {
    const id = await requestChange(db, staff, { kind: 'WORKED_TIME', shiftId: pastShift, startMin: t('10:30'), endMin: t('16:00'), breakMin: 30, reason: 'Gäste blieben länger' }, now);
    // the planned shift (4 h) already counts as worked as planned: the app records it by itself
    expect((await getMonthHours(db, staff, staff.userId, '2026-11', now)).totals.workedMinutes).toBe(240);
    await decideChangeRequest(db, planner, id, true, now);
    expect((await getMonthHours(db, staff, staff.userId, '2026-11', now)).totals.workedMinutes).toBe(300);
    // extra hours without a shift, in the future: not allowed
    await expect(requestChange(db, staff, { kind: 'WORKED_TIME', date: '2026-11-20', startMin: t('08:00'), endMin: t('11:00'), reason: 'Inventur' }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const extra = await requestChange(db, staff, { kind: 'WORKED_TIME', date: '2026-11-11', startMin: t('08:00'), endMin: t('11:00'), reason: 'Inventur' }, now);
    await decideChangeRequest(db, planner, extra, true, now);
    expect((await getMonthHours(db, staff, staff.userId, '2026-11', now)).totals.workedMinutes).toBe(480);
  });

  it('a planner who also works in service cannot approve their own request', async () => {
    const [u] = await db.select().from(users).where(eq(users.email, 'besteller@asiaway.test'));
    await saveProfile(db, planner, u!.id, { site: 'winterthur', employmentType: 'PART_TIME', pensumPercent: 80, active: true });
    const mine = await saveShift(db, planner, { site: 'winterthur', date: '2026-11-18', userId: u!.id, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    await publishWeek(db, planner, 'winterthur', '2026-11-16', now).catch(() => undefined);
    const id = await requestChange(db, planner, { kind: 'SHIFT_CANCEL', shiftId: mine, reason: 'krank' }, now);
    await expect(decideChangeRequest(db, planner, id, true, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
