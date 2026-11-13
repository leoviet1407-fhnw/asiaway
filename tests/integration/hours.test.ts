import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  countWeekdays,
  dailyCreditMinutes,
  formatOvertime,
  monthTargetMinutes,
  monthTotals,
  vacationBalance,
  vacationNeedsAttention,
  weeklyMinutes,
} from '@/domain/hours';
import { parseTime } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import {
  approveMonth,
  confirmShift,
  correctShift,
  deleteEntry,
  getMonthHours,
  getVacationBalance,
  reopenMonth,
  saveEntry,
  saveYearlyBalance,
} from '@/server/services/hours-service';
import { decideAbsence, publishWeek, requestAbsence, saveProfile, saveShift } from '@/server/services/roster-service';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;
/** These past shifts were planned weeks ahead (the current week is frozen now). */
const early = new Date('2026-10-01T09:00:00Z');

describe('vacation and overtime rules', () => {
  it('counts weekdays only', () => {
    expect(countWeekdays('2026-12-21', '2026-12-27', '2026-01-01', '2026-12-31')).toBe(5); // Mon–Sun
    expect(countWeekdays('2026-12-28', '2027-01-08', '2026-01-01', '2026-12-31')).toBe(4); // only 28–31 Dec count in 2026
    expect(countWeekdays('2026-12-26', '2026-12-27', '2026-01-01', '2026-12-31')).toBe(0); // weekend
  });

  it('works out vacation taken, requested and remaining', () => {
    const b = vacationBalance(2026, 25, 2, [
      { startDate: '2026-07-06', endDate: '2026-07-17', status: 'APPROVED', type: 'VACATION' }, // 10
      { startDate: '2026-12-21', endDate: '2026-12-25', status: 'REQUESTED', type: 'VACATION' }, // 5
      { startDate: '2026-03-02', endDate: '2026-03-06', status: 'REJECTED', type: 'VACATION' },
      { startDate: '2026-05-04', endDate: '2026-05-08', status: 'APPROVED', type: 'SICK' },
    ]);
    expect(b).toMatchObject({ taken: 10, requested: 5, remaining: 12, remainingApproved: 17 });
    expect(vacationNeedsAttention(b, '2026-10-15')).toBe(true);
    expect(vacationNeedsAttention(b, '2026-08-15')).toBe(false);
  });

  it('derives contract hours from 42.5 h at 100 %', () => {
    expect(weeklyMinutes(100)).toBe(2550);
    expect(weeklyMinutes(80)).toBe(2040); // 34 h
    expect(dailyCreditMinutes(80)).toBe(408); // 6.8 h
    expect(monthTargetMinutes(100, '2026-11')).toBe(Math.round((2550 * 30) / 7)); // 182.1 h
  });

  it('overtime = worked + credited vacation/sick − target; none without a pensum', () => {
    const base = { month: '2026-11', pensumPercent: 100, absences: [] as { startDate: string; endDate: string; type: 'VACATION' | 'SICK' | 'OTHER' }[] };
    expect(monthTotals({ ...base, workedMinutes: 190 * 60 }).overtimeMinutes).toBe(190 * 60 - 10929);
    const withVacation = monthTotals({ ...base, workedMinutes: 160 * 60, absences: [{ startDate: '2026-11-02', endDate: '2026-11-06', type: 'VACATION' }] });
    expect(withVacation.creditDays).toBe(5);
    expect(withVacation.creditMinutes).toBe(5 * 510);
    expect(withVacation.overtimeMinutes).toBe(160 * 60 + 5 * 510 - 10929);
    expect(monthTotals({ ...base, workedMinutes: 100, absences: [{ startDate: '2026-11-02', endDate: '2026-11-06', type: 'OTHER' }] }).creditDays).toBe(0);
    expect(monthTotals({ ...base, pensumPercent: null, workedMinutes: 600 })).toMatchObject({ targetMinutes: null, overtimeMinutes: null });
    expect(formatOvertime(210)).toBe('+3 h 30 min');
    expect(formatOvertime(-75)).toBe('−1 h 15 min');
    expect(formatOvertime(0)).toBe('±0');
  });
});

describe('hours service', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let staff: Principal;
  let other: Principal;
  let shiftId: string;
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
    other = await principal('winti-th@asiaway.test');
    await saveProfile(db, planner, staff.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
    shiftId = await saveShift(db, planner, { site: 'winterthur', date: '2026-11-10', userId: staff.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, early);
    await saveShift(db, planner, { site: 'winterthur', date: '2026-11-11', userId: staff.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, early);
  });
  afterAll(async () => close());

  it('offers only published shifts, and counts past ones as worked as planned', async () => {
    expect((await getMonthHours(db, staff, staff.userId, '2026-11', now)).planned).toEqual([]);
    await publishWeek(db, planner, 'winterthur', '2026-11-09', early);
    // Shifts that are over count as worked as planned by themselves: nobody has to tap anything
    const month = await getMonthHours(db, staff, staff.userId, '2026-11', now);
    expect(month.planned).toHaveLength(2);
    expect(month.entries).toHaveLength(2);
    expect(month.totals.workedMinutes).toBe(480);
    await confirmShift(db, staff, shiftId, now); // confirming again changes nothing: still one entry per shift
    await confirmShift(db, staff, shiftId, now);
    const after = await getMonthHours(db, staff, staff.userId, '2026-11', now);
    expect(after.entries).toHaveLength(2);
    expect(after.planned.find((s) => s.id === shiftId)!.entryId).not.toBeNull();
  });

  it('records corrections and extra work, but not the future or other people', async () => {
    const [, second] = (await getMonthHours(db, staff, staff.userId, '2026-11', now)).planned;
    // Staff cannot edit worked time themselves: they ask, the Leitung records it
    await expect(correctShift(db, staff, second!.id, { startMin: t('10:30'), endMin: t('16:00'), breakMin: 30, note: 'x' }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(saveEntry(db, staff, { userId: staff.userId, date: '2026-11-12', startMin: t('08:00'), endMin: t('11:00'), breakMin: 0, note: 'x' }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await correctShift(db, planner, second!.id, { startMin: t('10:30'), endMin: t('16:00'), breakMin: 30, note: 'Gäste blieben länger' }, now);
    await saveEntry(db, planner, { userId: staff.userId, date: '2026-11-12', startMin: t('08:00'), endMin: t('11:00'), breakMin: 0, note: 'Inventur' }, now);
    const month = await getMonthHours(db, staff, staff.userId, '2026-11', now);
    expect(month.totals.workedMinutes).toBe(240 + 300 + 180);
    await expect(saveEntry(db, planner, { userId: staff.userId, date: '2026-11-14', startMin: t('10:00'), endMin: t('12:00'), breakMin: 0, note: null }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(saveEntry(db, planner, { userId: staff.userId, date: '2026-11-12', startMin: t('12:00'), endMin: t('11:00'), breakMin: 0, note: null }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(saveEntry(db, other, { userId: staff.userId, date: '2026-11-12', startMin: t('08:00'), endMin: t('11:00'), breakMin: 0, note: null }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(getMonthHours(db, other, staff.userId, '2026-11', now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the month is approved by the Leitung, locked, and then counts towards the balance', async () => {
    await expect(approveMonth(db, staff, staff.userId, '2026-11', now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const before = await getMonthHours(db, planner, staff.userId, '2026-11', now);
    expect(before.yearBalanceMinutes).toBe(0); // nothing approved yet
    await approveMonth(db, planner, staff.userId, '2026-11', now);
    const approved = await getMonthHours(db, staff, staff.userId, '2026-11', now);
    expect(approved.approved).toBe(true);
    expect(approved.yearBalanceMinutes).toBe(approved.totals.overtimeMinutes);
    expect(approved.totals.overtimeMinutes).toBe(720 - monthTotalsTarget());
    const entryId = approved.entries[0]!.id;
    await expect(deleteEntry(db, planner, entryId)).rejects.toMatchObject({ code: 'MONTH_LOCKED' });
    await expect(saveEntry(db, planner, { userId: staff.userId, date: '2026-11-12', startMin: t('08:00'), endMin: t('09:00'), breakMin: 0, note: null }, now)).rejects.toMatchObject({ code: 'MONTH_LOCKED' });
    await reopenMonth(db, planner, staff.userId, '2026-11');
    await deleteEntry(db, planner, entryId);
  });

  it('adds the opening overtime balance of the year', async () => {
    await saveYearlyBalance(db, planner, staff.userId, 2026, { vacationDays: 25, vacationCarry: 0, overtimeCarryMin: 600 });
    await approveMonth(db, planner, staff.userId, '2026-11', now);
    const month = await getMonthHours(db, staff, staff.userId, '2026-11', now);
    expect(month.yearBalanceMinutes).toBe(600 + month.totals.overtimeMinutes!);
    await expect(saveYearlyBalance(db, staff, staff.userId, 2026, { vacationDays: 30, vacationCarry: 0, overtimeCarryMin: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('tracks the vacation balance across requests and approvals', async () => {
    await saveYearlyBalance(db, planner, staff.userId, 2026, { vacationDays: 25, vacationCarry: 3, overtimeCarryMin: 0 });
    const id = await requestAbsence(db, staff, { userId: staff.userId, startDate: '2026-12-21', endDate: '2026-12-27', type: 'VACATION', note: null }, now);
    let b = await getVacationBalance(db, staff, staff.userId, 2026);
    expect(b).toMatchObject({ entitlement: 25, carry: 3, taken: 0, requested: 5, remaining: 23 });
    await decideAbsence(db, planner, id, true, now);
    b = await getVacationBalance(db, staff, staff.userId, 2026);
    expect(b).toMatchObject({ taken: 5, requested: 0, remaining: 23, remainingApproved: 23 });
    await expect(getVacationBalance(db, other, staff.userId, 2026)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

/** The November 2026 target of a 100 % contract, in minutes. */
function monthTargetMinutesNov() {
  return monthTargetMinutes(100, '2026-11');
}
const monthTotalsTarget = monthTargetMinutesNov;
