import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  LEAD_DAYS,
  checkShiftTimes,
  dueMonth,
  isLunch,
  isOpenForStaff,
  mondayOf,
  parseTime,
  validateRoster,
  weeklyTargetCorridor,
  type RosterPerson,
  type Shift,
} from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import {
  copyWeek,
  createStaffUser,
  decideAbsence,
  getWeekView,
  listMyShifts,
  listTeam,
  publishWeek,
  requestAbsence,
  saveProfile,
  saveShift,
  setAvailability,
  submissionOverview,
  getWeekStatuses,
  submitMonth,
  getAvailabilityMonth,
} from '@/server/services/roster-service';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;
const person = (over: Partial<RosterPerson> & { userId: string }): RosterPerson => ({ name: over.userId, employmentType: 'FULL_TIME', pensumPercent: 100, ...over });
let n = 0;
const shift = (userId: string | null, date: string, start: string, end: string, over: Partial<Shift> = {}): Shift => ({
  id: `s${++n}`, userId, date, startMin: t(start), endMin: t(end), breakMin: 0, station: 'EG Thai', roleLabel: null, ...over,
});
const WEEK = '2026-11-09';
const codes = (v: { code: string }[]) => v.map((x) => x.code);

describe('roster rules', () => {
  it('parses times and weeks', () => {
    expect(parseTime('10:30')).toBe(630);
    expect(parseTime('10.30')).toBe(630);
    expect(parseTime('25:00')).toBe(1500);
    expect(parseTime('abc')).toBeNull();
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(isLunch(t('12:00'))).toBe(true);
    expect(isLunch(t('14:00'))).toBe(false);
    expect(checkShiftTimes(t('17:00'), t('16:00'), 0)).toMatch(/Ende/);
    expect(checkShiftTimes(t('10:00'), t('21:00'), 0)).toBeNull();
    expect(checkShiftTimes(t('08:00'), t('23:00'), 0)).toMatch(/14 Stunden/);
  });

  it('requires a month of notice', () => {
    expect(isOpenForStaff('2026-12-11', '2026-11-13')).toBe(true); // exactly 28 days
    expect(isOpenForStaff('2026-12-10', '2026-11-13')).toBe(false);
    expect(LEAD_DAYS).toBe(28);
    expect(dueMonth('2026-11-13')).toBe('2026-12');
  });

  it('flags overlap, rest, span, breaks and days in a row', () => {
    const people = [person({ userId: 'a' })];
    const v = validateRoster({
      weekStart: WEEK,
      people,
      availability: [],
      absences: [],
      shifts: [
        shift('a', '2026-11-09', '17:00', '23:00'), // closes late
        shift('a', '2026-11-10', '08:00', '12:00'), // only 9 h rest
        shift('a', '2026-11-10', '11:00', '13:00'), // overlaps
        shift('a', '2026-11-11', '10:30', '14:30'),
        shift('a', '2026-11-11', '17:30', '23:30'), // 13 h span
        shift('a', '2026-11-12', '10:00', '16:00'), // 6 h without a break
        shift('a', '2026-11-13', '10:00', '14:00'),
        shift('a', '2026-11-14', '10:00', '14:00'),
        shift('a', '2026-11-15', '10:00', '14:00'), // 7th day in a row
      ],
    });
    const c = codes(v);
    expect(c).toContain('REST');
    expect(c).toContain('OVERLAP');
    expect(c).toContain('LONG_SPAN');
    expect(c).toContain('BREAK');
    expect(c).toContain('CONSECUTIVE');
  });

  it('a split shift with a long gap is fine when rest and span are respected', () => {
    const v = validateRoster({
      weekStart: WEEK,
      people: [person({ userId: 'a' })],
      availability: [],
      absences: [],
      shifts: [shift('a', '2026-11-09', '10:30', '14:30'), shift('a', '2026-11-09', '17:30', '22:00'), shift('a', '2026-11-10', '10:30', '14:30')],
    });
    expect(codes(v).filter((x) => ['REST', 'OVERLAP', 'SPAN', 'LONG_SPAN'].includes(x))).toEqual([]);
  });

  it('holds Aushilfen to what they offered, and only warns for contracted staff', () => {
    const people = [person({ userId: 'aus', employmentType: 'ON_CALL', pensumPercent: null }), person({ userId: 'fix' })];
    const v = validateRoster({
      weekStart: WEEK,
      people,
      absences: [{ userId: 'fix', startDate: '2026-11-11', endDate: '2026-11-12', type: 'VACATION' }],
      availability: [
        { userId: 'aus', date: '2026-11-09', kind: 'AVAILABLE', fromMin: t('17:00'), toMin: t('21:00') },
        { userId: 'aus', date: '2026-11-10', kind: 'UNAVAILABLE', fromMin: null, toMin: null },
        { userId: 'fix', date: '2026-11-09', kind: 'UNAVAILABLE', fromMin: null, toMin: null },
      ],
      shifts: [
        shift('aus', '2026-11-09', '17:00', '22:00'), // outside the offered window
        shift('aus', '2026-11-10', '17:00', '21:00'), // said no
        shift('aus', '2026-11-11', '17:00', '21:00'), // never reported
        shift('fix', '2026-11-09', '10:30', '14:30'), // wanted off: warning only
        shift('fix', '2026-11-11', '10:30', '14:30'), // on holiday: error
      ],
    });
    const by = (code: string) => v.filter((x) => x.code === code);
    expect(by('OUTSIDE_OFFER')[0]!.severity).toBe('error');
    expect(by('UNAVAILABLE').map((x) => [x.userId, x.severity]).sort()).toEqual([['aus', 'error'], ['fix', 'warn']]);
    expect(by('NO_OFFER')[0]!.severity).toBe('warn'); // casual staff without a report: a note, the Leitung confirms by phone
    expect(by('ABSENCE')[0]!.severity).toBe('error');
  });

  it('measures weekly hours against the pensum corridor', () => {
    expect(weeklyTargetCorridor(80)).toEqual({ minMin: 1920, maxMin: 2040 });
    const people = [person({ userId: 'a', pensumPercent: 80 })];
    const few = validateRoster({ weekStart: WEEK, people, availability: [], absences: [], shifts: [shift('a', '2026-11-09', '10:30', '14:30', { breakMin: 0 })] });
    expect(codes(few)).toContain('UNDER');
    const ok = validateRoster({
      weekStart: WEEK,
      people,
      availability: [],
      absences: [],
      shifts: ['09', '10', '11', '12'].map((d) => shift('a', `2026-11-${d}`, '10:30', '19:00', { breakMin: 30 })).concat(),
    });
    expect(codes(ok)).not.toContain('UNDER');
    expect(codes(ok)).not.toContain('OVER');
  });

  it('reports open shifts', () => {
    const v = validateRoster({ weekStart: WEEK, people: [], availability: [], absences: [], shifts: [shift(null, '2026-11-09', '10:30', '14:30')] });
    expect(codes(v)).toEqual(['OPEN_SHIFT']);
  });
});

describe('roster service', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let admin: Principal;
  let planner: Principal;
  let staffVn: Principal;
  let staffTh: Principal;
  let staffOer: Principal;
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };
  const now = new Date('2026-11-13T09:00:00Z');

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    admin = await principal('admin@asiaway.test');
    planner = await principal('besteller@asiaway.test');
    staffVn = await principal('winti-vn@asiaway.test');
    staffTh = await principal('winti-th@asiaway.test');
    staffOer = await principal('oerlikon@asiaway.test');
    await saveProfile(db, planner, staffVn.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
    await saveProfile(db, planner, staffTh.userId, { site: 'winterthur', employmentType: 'ON_CALL', pensumPercent: null, active: true });
    await saveProfile(db, planner, staffOer.userId, { site: 'oerlikon', employmentType: 'PART_TIME', pensumPercent: 60, active: true });
  });
  afterAll(async () => close());

  it('keeps one team and one plan for both Winterthur restaurants', async () => {
    const team = await listTeam(db, 'winterthur');
    const ids = team.map((m) => m.userId);
    expect(ids).toContain(staffVn.userId);
    expect(ids).toContain(staffTh.userId);
    expect(ids).not.toContain(staffOer.userId); // Oerlikon has its own roster
    await expect(saveProfile(db, staffVn, staffVn.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(saveProfile(db, planner, staffVn.userId, { site: 'winterthur', employmentType: 'PART_TIME', pensumPercent: null, active: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('only the planner plans; staff see a week only once it is published', async () => {
    const base = { site: 'winterthur', date: '2026-11-17', userId: staffVn.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: 'À la carte' };
    await expect(saveShift(db, staffVn, base, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(saveShift(db, planner, { ...base, station: 'Keller' }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(saveShift(db, planner, { ...base, userId: staffOer.userId }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const id = await saveShift(db, planner, base, now);
    await saveShift(db, planner, { ...base, id, date: '2026-11-17', endMin: t('15:00') }, now);

    expect((await getWeekView(db, staffVn, 'winterthur', '2026-11-16')).hidden).toBe(true);
    expect((await getWeekView(db, staffVn, 'winterthur', '2026-11-16')).shifts).toEqual([]);
    expect(await listMyShifts(db, staffVn, '2026-11-01', '2026-11-30')).toEqual([]);
    await expect(getWeekView(db, staffOer, 'winterthur', '2026-11-16')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await publishWeek(db, planner, 'winterthur', '2026-11-16', now);
    const view = await getWeekView(db, staffVn, 'winterthur', '2026-11-16');
    expect(view.hidden).toBe(false);
    expect(view.shifts).toHaveLength(1);
    expect(view.violations).toEqual([]); // staff do not see the checks
    expect((await listMyShifts(db, staffVn, '2026-11-01', '2026-11-30')).map((s) => s.date)).toEqual(['2026-11-17']);
  });

  it('refuses to publish a week with errors', async () => {
    // The Aushilfe marked the day as not available, so this assignment is an error (no report at all is only a note).
    await setAvailability(db, planner, { userId: staffTh.userId, date: '2026-11-24', kind: 'UNAVAILABLE', fromMin: null, toMin: null }, now);
    await saveShift(db, planner, { site: 'winterthur', date: '2026-11-24', userId: staffTh.userId, startMin: t('17:00'), endMin: t('21:00'), breakMin: 0, station: '1. OG', roleLabel: null }, now);
    await expect(publishWeek(db, planner, 'winterthur', '2026-11-23', now)).rejects.toMatchObject({ code: 'ROSTER_BLOCKED' });
    await setAvailability(db, planner, { userId: staffTh.userId, date: '2026-11-24', kind: 'AVAILABLE', fromMin: t('16:00'), toMin: t('22:00') }, now);
    await publishWeek(db, planner, 'winterthur', '2026-11-23', now);
  });

  it('copies a week into an empty one', async () => {
    expect(await copyWeek(db, planner, 'winterthur', '2026-11-30')).toBe(1);
    await expect(copyWeek(db, planner, 'winterthur', '2026-11-30')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lets staff report availability only a month ahead, and the planner any day', async () => {
    const closeDay = { userId: staffTh.userId, date: '2026-11-20', kind: 'AVAILABLE' as const, fromMin: null, toMin: null };
    await expect(setAvailability(db, staffTh, closeDay, now)).rejects.toMatchObject({ code: 'TOO_LATE' });
    await setAvailability(db, planner, closeDay, now);
    const farDay = { userId: staffTh.userId, date: '2026-12-12', kind: 'AVAILABLE' as const, fromMin: t('17:00'), toMin: t('22:00') };
    await setAvailability(db, staffTh, farDay, now);
    await setAvailability(db, staffTh, { ...farDay, date: '2026-12-13', kind: 'UNAVAILABLE', fromMin: null, toMin: null }, now);
    await expect(setAvailability(db, staffVn, { ...farDay, userId: staffTh.userId }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setAvailability(db, staffTh, { ...farDay, fromMin: t('22:00'), toMin: t('17:00') }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const month = await getAvailabilityMonth(db, staffTh, staffTh.userId, '2026-12');
    expect(month.days.map((d) => [d.date, d.kind])).toEqual([['2026-12-12', 'AVAILABLE'], ['2026-12-13', 'UNAVAILABLE']]);
    await setAvailability(db, staffTh, { userId: staffTh.userId, date: '2026-12-13', kind: null, fromMin: null, toMin: null }, now);
    expect((await getAvailabilityMonth(db, staffTh, staffTh.userId, '2026-12')).days).toHaveLength(1);
  });

  it('shows the planner who has reported for the month', async () => {
    // The Aushilfe has to decide every day she can still change before the report can be sent.
    await expect(submitMonth(db, staffTh, '2026-12', now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    for (const d of (await getWeekStatuses(db, staffTh, staffTh.userId, '2026-12', now)).missingDays) {
      await setAvailability(db, staffTh, { userId: staffTh.userId, date: d, kind: 'UNAVAILABLE', fromMin: null, toMin: null }, now);
    }
    let overview = await submissionOverview(db, planner, 'winterthur', '2026-12');
    expect(overview.find((o) => o.person.userId === staffTh.userId)!.submittedAt).toBeNull();
    await submitMonth(db, staffTh, '2026-12', now);
    overview = await submissionOverview(db, planner, 'winterthur', '2026-12');
    expect(overview.find((o) => o.person.userId === staffTh.userId)!.submittedAt).not.toBeNull();
    expect(overview.find((o) => o.person.userId === staffTh.userId)!.availableDays).toBe(1);
    expect((await getWeekStatuses(db, staffTh, staffTh.userId, '2026-12', now)).missingDays).toEqual([]);
    await expect(submissionOverview(db, staffVn, 'winterthur', '2026-12')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('handles holiday requests: staff ask, the planner decides, approved holidays block shifts', async () => {
    const id = await requestAbsence(db, staffVn, { userId: staffVn.userId, startDate: '2026-12-21', endDate: '2026-12-27', type: 'VACATION', note: null }, now);
    await expect(requestAbsence(db, staffVn, { userId: staffVn.userId, startDate: '2026-12-21', endDate: '2026-12-27', type: 'SICK', note: null }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(requestAbsence(db, staffVn, { userId: staffTh.userId, startDate: '2026-12-21', endDate: '2026-12-27', type: 'VACATION', note: null }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(decideAbsence(db, staffVn, id, true, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Not approved yet: no effect on the plan.
    await saveShift(db, planner, { site: 'winterthur', date: '2026-12-22', userId: staffVn.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    expect((await getWeekView(db, planner, 'winterthur', '2026-12-21')).violations.map((v) => v.code)).not.toContain('ABSENCE');
    await decideAbsence(db, planner, id, true, now);
    expect((await getWeekView(db, planner, 'winterthur', '2026-12-21')).violations.map((v) => v.code)).toContain('ABSENCE');
    // A sick day entered by the planner is approved at once.
    await requestAbsence(db, planner, { userId: staffVn.userId, startDate: '2026-11-18', endDate: '2026-11-18', type: 'SICK', note: null }, now);
  });

  it('only an admin creates a team member with a login', async () => {
    const input = { name: 'Neue Person', email: 'neu@asiaway.test', password: 'start-pass-1', site: 'winterthur', employmentType: 'PART_TIME' as const, pensumPercent: 50, active: true };
    await expect(createStaffUser(db, planner, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const id = await createStaffUser(db, admin, input);
    expect((await listTeam(db, 'winterthur')).map((m) => m.userId)).toContain(id);
    await expect(createStaffUser(db, admin, input)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('a contracted person cannot send the month until every day is chosen and each week reaches the contract', async () => {
    // January 2027: weeks start 04, 11, 18, 25. staffVn is 100 % = 42.5 h a week.
    const jan = '2027-01';
    const all = (await getWeekStatuses(db, staffVn, staffVn.userId, jan, now)).missingDays;
    expect(all.length).toBe(28); // four full weeks, nothing chosen yet
    await expect(submitMonth(db, staffVn, jan, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('28 Tage ohne Auswahl') });

    // Every day "Frei": all days decided, but no hours offered → too few hours.
    for (const d of all) await setAvailability(db, staffVn, { userId: staffVn.userId, date: d, kind: 'UNAVAILABLE', fromMin: null, toMin: null }, now);
    await expect(submitMonth(db, staffVn, jan, now)).rejects.toMatchObject({ message: expect.stringContaining('Zu wenig Stunden') });

    // Four whole days a week is 34 h: still not 42.5 h.
    for (const monday of ['2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25']) {
      for (const offset of [0, 1, 2, 3]) {
        const d = new Date(`${monday}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + offset);
        await setAvailability(db, staffVn, { userId: staffVn.userId, date: d.toISOString().slice(0, 10), kind: 'AVAILABLE', fromMin: null, toMin: null }, now);
      }
    }
    await expect(submitMonth(db, staffVn, jan, now)).rejects.toMatchObject({ message: expect.stringContaining('34.0 h / 42.5 h') });

    // A fifth whole day each week reaches 42.5 h: now it can be sent.
    for (const monday of ['2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25']) {
      const d = new Date(`${monday}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 4);
      await setAvailability(db, staffVn, { userId: staffVn.userId, date: d.toISOString().slice(0, 10), kind: 'AVAILABLE', fromMin: null, toMin: null }, now);
    }
    await submitMonth(db, staffVn, jan, now);
    const overview = await submissionOverview(db, planner, 'winterthur', jan);
    expect(overview.find((o) => o.person.userId === staffVn.userId)!.submittedAt).not.toBeNull();
  });
  it('a manager can be planned at both sites', async () => {
    const id = await createStaffUser(db, admin, { name: 'Zwei Standorte', email: 'beide@asiaway.test', password: 'testpasswort1', site: 'oerlikon', extraSites: ['winterthur'], employmentType: 'PART_TIME', pensumPercent: 80, active: true });
    expect((await listTeam(db, 'oerlikon')).some((m) => m.userId === id)).toBe(true);
    expect((await listTeam(db, 'winterthur')).some((m) => m.userId === id)).toBe(true);
    const mon = '2027-03-01';
    // The same person on two sites on one day: Oerlikon lunch, Winterthur dinner works
    await saveShift(db, planner, { site: 'oerlikon', date: mon, userId: id, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'Service', roleLabel: null });
    await saveShift(db, planner, { site: 'winterthur', date: mon, userId: id, startMin: t('17:30'), endMin: t('22:00'), breakMin: 0, station: 'EG Thai', roleLabel: null });
    // A one-site person may not be put on the other site
    await expect(saveShift(db, planner, { site: 'winterthur', date: mon, userId: (await listTeam(db, 'oerlikon')).find((m) => m.userId !== id)!.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null })).rejects.toThrow();
    // The saved profile gives the login access to both sites' restaurants
    const me = await loadPrincipalForUser(db, id);
    expect(me!.grants.map((g) => g.locationId).sort()).toEqual(['oerlikon', 'winti-th', 'winti-vn']);
  });
});
