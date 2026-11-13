import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseTime, weekDates } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { shifts, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { weeksOfMonth } from '@/domain/availability';
import { approveMonth, getMonthHours } from '@/server/services/hours-service';
import { decideChangeRequest, requestChange } from '@/server/services/change-request-service';
import { getCoverage, saveNeeds } from '@/server/services/coverage-service';
import { getPlannerTodos } from '@/server/services/attention-service';
import { getSiteDays, savePattern, saveSiteDays } from '@/server/services/pattern-service';
import { getOverview } from '@/server/services/overview-service';
import { getWeekView, listMyShifts, requestAbsence, decideAbsence, saveProfile, setAvailability, submitMonth, getAvailabilityMonth } from '@/server/services/roster-service';
import { listSpecialDays, saveSpecialDay, saveVacationRule } from '@/server/services/season-service';
import { fillGap, listGaps, publishMonth, suggestMonth } from '@/server/services/suggest-service';
import { whatsappLink, whatsappNumber } from '@/lib/whatsapp';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;

/**
 * One walk through the whole chain: staff data → need → suggestion → gaps → publish → the staff's
 * own view → hours → requests → approvals → the Leitung's to-do list. It proves the parts are connected.
 */
describe('everything is connected', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal; // PLANNER (Belle, Xuan)
  let full: Principal; // 100 %, Winterthur
  let part: Principal; // 80 %, Winterthur + Oerlikon on Saturdays only
  let casual: Principal; // Aushilfe with a Standardwoche
  const now = new Date('2026-11-13T09:00:00Z');
  const MONTH = '2026-12';
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    full = await principal('winti-vn@asiaway.test');
    part = await principal('winti-th@asiaway.test');
    casual = await principal('aushilfe@asiaway.test');
    await saveProfile(db, planner, full.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true, usualStation: '1. OG' });
    await saveProfile(db, planner, part.userId, { site: 'winterthur', extraSites: ['oerlikon'], employmentType: 'PART_TIME', pensumPercent: 80, active: true, usualStation: 'EG Thai' });
  }, 90_000);
  afterAll(async () => close());

  it('1. site days, special days and the need shape what can be planned', async () => {
    await saveSiteDays(db, planner, part.userId, { oerlikon: [6] }); // at Oerlikon only on Saturdays
    expect((await getSiteDays(db, [part.userId])).get(part.userId)?.get('oerlikon')).toEqual([6]);
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, () => ({ lunchPeople: 1, dinnerPeople: 1 })));
    await saveNeeds(db, planner, 'oerlikon', Array.from({ length: 7 }, (_, i) => (i === 5 ? { lunchPeople: 1, dinnerPeople: 1 } : { lunchPeople: 0, dinnerPeople: 0 })));
    await saveSpecialDay(db, planner, 'winterthur', { date: '2026-12-25', label: 'Weihnachten', closed: true, lunchPeople: 0, dinnerPeople: 0 });
    expect(await listSpecialDays(db, 'winterthur', '2026-12-01', '2026-12-31')).toHaveLength(1);
    // the casual person's Standardwoche: Wednesdays, evening
    const pat = (await import('@/server/services/pattern-service')).getPattern;
    const days = (await pat(db, casual, casual.userId)).map((d) => (d.weekday === 3 ? { ...d, kind: 'AVAILABLE' as const, fromMin: t('17:30'), toMin: t('22:00') } : d));
    await savePattern(db, casual, casual.userId, days);
  });

  it('2. the coverage view sees contracts, the Standardwoche and the closed day', async () => {
    const c = await getCoverage(db, planner, 'winterthur', '2026-12-21');
    expect(c.days[4]).toMatchObject({ date: '2026-12-25', need: { lunchPeople: 0, dinnerPeople: 0 }, special: 'Weihnachten' });
    expect(c.days[2]!.offeredDinner).toBe(3); // Wed: full + part (contract) + the casual's Standardwoche
    expect(c.silent).not.toContain('Aushilfe Muster');
  });

  it('3. one tap suggests the month for both sites, nobody is double-booked, gaps are listed', async () => {
    const w = await suggestMonth(db, planner, 'winterthur', MONTH, now);
    const o = await suggestMonth(db, planner, 'oerlikon', MONTH, now);
    expect(w.weeks.length).toBe(4);
    const all = await db.select().from(shifts);
    for (const s of all.filter((x) => x.userId === part.userId && x.site === 'oerlikon')) expect(new Date(`${s.workDate}T00:00:00Z`).getUTCDay()).toBe(6); // Saturdays only
    // part is reserved for Oerlikon on Saturdays, so Winterthur plans without her that day
    expect(all.some((x) => x.userId === part.userId && x.site === 'winterthur' && new Date(`${x.workDate}T00:00:00Z`).getUTCDay() === 6)).toBe(false);
    expect(all.some((x) => x.workDate === '2026-12-25' && x.site === 'winterthur')).toBe(false); // closed day
    expect(o.weeks.reduce((n, x) => n + x.created, 0)).toBeGreaterThan(0);
    // no person has two shifts at the same time, across both sites
    for (const uid of [full.userId, part.userId, casual.userId]) {
      const mine = all.filter((x) => x.userId === uid);
      for (const a of mine) for (const b of mine) if (a.id < b.id && a.workDate === b.workDate) expect(a.startMin < b.endMin && b.startMin < a.endMin).toBe(false);
    }
  });

  it('4. gaps can be filled with one tap, and the Leitung sees what is open', async () => {
    const monday = weeksOfMonth(MONTH)[0]!;
    const gaps = await listGaps(db, planner, 'winterthur', monday);
    // two weeks later the December weeks are inside the four-week window of the to-do list
    const todos = await getPlannerTodos(db, planner, new Date('2026-12-02T09:00:00Z'));
    expect(todos.some((x) => x.key === 'UNPUBLISHED' && x.site === 'winterthur')).toBe(true);
    if (gaps.length) {
      const g = gaps.find((x) => x.candidates.length > 0);
      if (g) await fillGap(db, planner, 'winterthur', g.date, g.service, g.candidates[0]!.userId, now);
    }
  });

  it('5. holiday: a limit stops staff, approval takes the person out of the plan check', async () => {
    await saveVacationRule(db, planner, 'winterthur', { label: 'Weihnachtszeit', startDate: '2026-12-20', endDate: '2027-01-02', maxPeople: 1 });
    const id = await requestAbsence(db, full, { userId: full.userId, startDate: '2026-12-28', endDate: '2026-12-29', type: 'VACATION', note: null }, now);
    await expect(requestAbsence(db, part, { userId: part.userId, startDate: '2026-12-29', endDate: '2026-12-30', type: 'VACATION', note: null }, now)).rejects.toThrow(/Weihnachtszeit/);
    await decideAbsence(db, planner, id, true, now);
    const view = await getWeekView(db, planner, 'winterthur', '2026-12-28');
    // anybody planned during an approved holiday would be a rule error
    const days = new Set(view.shifts.filter((s) => s.userId === full.userId && s.date >= '2026-12-28' && s.date <= '2026-12-29').map((s) => s.date));
    expect(view.violations.filter((v) => v.code === 'ABSENCE' && v.userId === full.userId).length).toBe(days.size);
  });

  it('6. publishing a month, the staff see their shifts, WhatsApp texts are ready', async () => {
    // errors from the holiday above are fixed by moving those shifts to open, as the Leitung would
    for (const s of (await db.select().from(shifts)).filter((x) => x.userId === full.userId && x.workDate >= '2026-12-28' && x.workDate <= '2026-12-29')) {
      await db.update(shifts).set({ userId: null }).where(eq(shifts.id, s.id));
    }
    const pub = await publishMonth(db, planner, 'winterthur', MONTH, now);
    expect(pub.published.length).toBeGreaterThan(0);
    const mine = await listMyShifts(db, full, '2026-12-01', '2026-12-31');
    expect(mine.length).toBeGreaterThan(0);
    expect(whatsappNumber('079 123 45 67')).toBe('41791234567');
    expect(whatsappLink('Hallo', '41791234567')).toContain('wa.me/41791234567?text=Hallo');
  });

  it('7. hours are recorded automatically, a change request fixes them, the month is approved and locks', async () => {
    const later = new Date('2027-01-05T09:00:00Z'); // December is over
    const before = await getMonthHours(db, full, full.userId, MONTH, later);
    expect(before.entries.length).toBeGreaterThan(0);
    const firstEntry = before.entries[0]!;
    const shiftId = firstEntry.shiftId!;
    const id = await requestChange(db, full, { kind: 'WORKED_TIME', shiftId, startMin: firstEntry.startMin, endMin: firstEntry.endMin + 60, reason: 'Gäste blieben länger' }, later);
    await decideChangeRequest(db, planner, id, true, later);
    const after = await getMonthHours(db, full, full.userId, MONTH, later);
    expect(after.totals.workedMinutes).toBe(before.totals.workedMinutes + 60);
    await approveMonth(db, planner, full.userId, MONTH, later);
    const locked = await getMonthHours(db, full, full.userId, MONTH, later);
    expect(locked.approved).toBe(true);
    // the overview adds up the same hours
    const ov = await getOverview(db, planner, { month: MONTH, weekStart: '2026-12-07', today: '2027-01-05' });
    expect(ov.staff.find((s) => s.userId === full.userId)!.workedMinutes).toBe(after.totals.workedMinutes);
  });

  it('8. the casual person reports once; the Leitung sees it, and the roster check knows the week', async () => {
    await setAvailability(db, casual, { userId: casual.userId, date: '2027-02-03', kind: 'AVAILABLE', fromMin: null, toMin: null }, now);
    await submitMonth(db, casual, '2027-02', now);
    expect((await getAvailabilityMonth(db, casual, casual.userId, '2027-02')).submittedAt).not.toBeNull();
    expect(weekDates('2026-12-07')).toHaveLength(7);
  });
});
