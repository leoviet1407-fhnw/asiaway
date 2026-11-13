import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parseTime } from '@/domain/roster';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { shifts, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { applyPattern, fillMissingFromPatterns, getPattern, getSiteDays, savePattern, saveSiteDays } from '@/server/services/pattern-service';
import { getCoverage, saveNeeds } from '@/server/services/coverage-service';
import { deleteVacationRule, listSpecialDays, listVacationRules, saveSpecialDay, saveVacationRule } from '@/server/services/season-service';
import { copyWeek, getAvailabilityMonth, getWeekView, requestAbsence, saveProfile, saveShift, submissionOverview } from '@/server/services/roster-service';
import { fillGap, listGaps, publishMonth, suggestMonth, suggestWeek } from '@/server/services/suggest-service';
import { createTestDatabase } from '../helpers/db';

const t = (s: string) => parseTime(s)!;

describe('season: pattern, special days, vacation limits, suggestion', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let a: Principal;
  let b: Principal;
  const now = new Date('2026-11-13T09:00:00Z');
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    a = await principal('winti-vn@asiaway.test');
    b = await principal('winti-th@asiaway.test');
    for (const p of [a, b]) await saveProfile(db, planner, p.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
  }, 60_000);
  afterAll(async () => close());

  it('the Standardwoche fills a month once and never overwrites choices', async () => {
    await expect(applyPattern(db, a, a.userId, '2027-01', now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const days = (await getPattern(db, a, a.userId)).map((d) => (d.weekday <= 5 ? { ...d, kind: 'AVAILABLE' as const, fromMin: null, toMin: null } : { ...d, kind: 'UNAVAILABLE' as const }));
    await savePattern(db, a, a.userId, days);
    await expect(savePattern(db, b, a.userId, days)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const n = await applyPattern(db, a, a.userId, '2027-01', now);
    expect(n).toBeGreaterThanOrEqual(28);
    expect(await applyPattern(db, a, a.userId, '2027-01', now)).toBe(0); // nothing left to fill
    const month = await getAvailabilityMonth(db, a, a.userId, '2027-01');
    expect(month.days.find((d) => d.date === '2027-01-04')).toMatchObject({ kind: 'AVAILABLE' }); // a Monday
    expect(month.days.find((d) => d.date === '2027-01-09')).toMatchObject({ kind: 'UNAVAILABLE' }); // a Saturday
    // people with a Pensum report nothing, so the Leitung's fill-in only concerns casual staff
    expect(await fillMissingFromPatterns(db, planner, 'winterthur', '2027-02', now)).toMatchObject({ people: 0 });
  });

  it('special days change the need of that date only', async () => {
    const weekStart = '2026-12-21';
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, () => ({ lunchPeople: 3, dinnerPeople: 4 })));
    await saveSpecialDay(db, planner, 'winterthur', { date: '2026-12-25', label: 'Weihnachten', closed: true, lunchPeople: 0, dinnerPeople: 0 });
    await saveSpecialDay(db, planner, 'winterthur', { date: '2026-12-24', label: 'Heiligabend', closed: false, lunchPeople: 2, dinnerPeople: 0 });
    const cov = await getCoverage(db, planner, 'winterthur', weekStart);
    expect(cov.days.find((d) => d.date === '2026-12-25')).toMatchObject({ need: { lunchPeople: 0, dinnerPeople: 0 }, special: 'Weihnachten' });
    expect(cov.days.find((d) => d.date === '2026-12-24')!.need).toEqual({ lunchPeople: 2, dinnerPeople: 0 });
    expect(cov.days.find((d) => d.date === '2026-12-23')).toMatchObject({ need: { lunchPeople: 3, dinnerPeople: 4 }, special: null });
    expect(await listSpecialDays(db, 'winterthur', '2026-12-01', '2026-12-31')).toHaveLength(2);
    await expect(saveSpecialDay(db, a, 'winterthur', { date: '2026-12-26', label: 'x', closed: true, lunchPeople: 0, dinnerPeople: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('holiday limits stop staff but not the Leitung', async () => {
    await saveVacationRule(db, planner, 'winterthur', { label: 'Weihnachtszeit', startDate: '2026-12-20', endDate: '2027-01-02', maxPeople: 1 });
    expect(await listVacationRules(db, 'winterthur')).toHaveLength(1);
    await requestAbsence(db, a, { userId: a.userId, startDate: '2026-12-24', endDate: '2026-12-28', type: 'VACATION', note: null }, now);
    await expect(requestAbsence(db, b, { userId: b.userId, startDate: '2026-12-27', endDate: '2026-12-30', type: 'VACATION', note: null }, now)).rejects.toThrow(/27\.12\.2026.*Weihnachtszeit/);
    await requestAbsence(db, b, { userId: b.userId, startDate: '2026-12-29', endDate: '2026-12-30', type: 'VACATION', note: null }, now); // free days
    await requestAbsence(db, planner, { userId: b.userId, startDate: '2026-12-26', endDate: '2026-12-26', type: 'VACATION', note: null }, now); // Leitung may override
    const [rule] = await listVacationRules(db, 'winterthur');
    await deleteVacationRule(db, planner, rule!.id);
    expect(await listVacationRules(db, 'winterthur')).toHaveLength(0);
  });

  it('suggests a draft week from need, offers and pattern, and reports gaps', async () => {
    const weekStart = '2027-01-11';
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, (_, i) => (i < 5 ? { lunchPeople: 1, dinnerPeople: 1 } : { lunchPeople: 0, dinnerPeople: 0 })));
    const r = await suggestWeek(db, planner, 'winterthur', weekStart, now);
    // a and b are contract staff: they report nothing and count as available
    expect(r.created).toBeGreaterThan(0);
    const rows = await db.select().from(shifts);
    expect(rows.filter((s) => s.workDate >= weekStart && s.workDate <= '2027-01-17').length).toBe(r.created);
    expect(r.gaps.length).toBe(0);
    expect((await suggestWeek(db, planner, 'winterthur', weekStart, now)).created).toBe(0); // nothing is missing any more: running it again changes nothing
    await expect(suggestWeek(db, a, 'winterthur', '2027-01-18', now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    void t;
  });

  it('an Aushilfe with a Standardwoche can be planned without a monthly report', async () => {
    const [u] = await db.select().from(users).where(eq(users.email, 'oerlikon@asiaway.test'));
    const casual = (await loadPrincipalForUser(db, u!.id))!;
    await saveProfile(db, planner, casual.userId, { site: 'winterthur', employmentType: 'ON_CALL', pensumPercent: null, active: true });
    const week = '2027-03-01';
    await saveShift(db, planner, { site: 'winterthur', date: '2027-03-02', userId: casual.userId, startMin: t('17:30'), endMin: t('22:00'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    expect((await getWeekView(db, planner, 'winterthur', week)).violations.some((v) => v.code === 'NO_OFFER' && v.userId === casual.userId)).toBe(true);
    const pat = (await getPattern(db, casual, casual.userId)).map((d) => (d.weekday === 2 ? { ...d, kind: 'AVAILABLE' as const, fromMin: null, toMin: null } : d));
    await savePattern(db, casual, casual.userId, pat);
    expect((await getWeekView(db, planner, 'winterthur', week)).violations.some((v) => v.code === 'NO_OFFER' && v.userId === casual.userId)).toBe(false);
  });

  it('suggests a month, lists the gaps, fills one with a tap and publishes the month', async () => {
    const month = '2027-04';
    const r = await suggestMonth(db, planner, 'winterthur', month, now);
    expect(r.weeks.length).toBeGreaterThanOrEqual(4);
    expect(r.weeks.every((w) => w.skipped === null)).toBe(true);
    // b has no Standardwoche and no report: the second person of each service is missing
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, (_, i) => (i < 5 ? { lunchPeople: 2, dinnerPeople: 1 } : { lunchPeople: 0, dinnerPeople: 0 })));
    const gaps = await listGaps(db, planner, 'winterthur', '2027-04-05');
    expect(gaps.some((g) => g.service === 'LUNCH' && g.missing === 1)).toBe(true);
    const gap = gaps.find((g) => g.candidates.length > 0);
    if (gap) {
      await fillGap(db, planner, 'winterthur', gap.date, gap.service, gap.candidates[0]!.userId, now);
      const after = await listGaps(db, planner, 'winterthur', '2027-04-05');
      expect(after.find((g) => g.date === gap.date && g.service === gap.service)?.missing ?? 0).toBeLessThan(gap.missing);
    }
    await expect(fillGap(db, planner, 'winterthur', '2027-04-05', 'LUNCH', 'not-a-person', now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const pub = await publishMonth(db, planner, 'winterthur', month, now);
    expect(pub.published.length + pub.blocked.length).toBeGreaterThanOrEqual(1);
    await expect(publishMonth(db, a, 'winterthur', month, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a Standardwoche counts as the report of casual staff: coverage and overview use it', async () => {
    const [u] = await db.select().from(users).where(eq(users.email, 'aushilfe@asiaway.test'));
    const casual = (await loadPrincipalForUser(db, u!.id))!;
    const week = '2027-05-03';
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, () => ({ lunchPeople: 5, dinnerPeople: 5 })));
    const before = await getCoverage(db, planner, 'winterthur', week);
    const overviewBefore = (await submissionOverview(db, planner, 'winterthur', '2027-05')).find((o) => o.person.userId === casual.userId)!;
    expect(overviewBefore.hasPattern).toBe(false);
    const pat = (await getPattern(db, casual, casual.userId)).map((d) => (d.weekday === 1 ? { ...d, kind: 'AVAILABLE' as const, fromMin: t('17:30'), toMin: t('22:00') } : d));
    await savePattern(db, casual, casual.userId, pat);
    const after = await getCoverage(db, planner, 'winterthur', week);
    expect(after.days[0]!.offeredDinner).toBe(before.days[0]!.offeredDinner + 1); // Monday evening
    expect(after.days[0]!.offeredLunch).toBe(before.days[0]!.offeredLunch);
    expect(after.silent).not.toContain('Aushilfe Muster');
    expect((await submissionOverview(db, planner, 'winterthur', '2027-05')).find((o) => o.person.userId === casual.userId)!.hasPattern).toBe(true);
  });

  it('people who work at a site only on certain weekdays are planned only then', async () => {
    const week = '2027-06-07';
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, () => ({ lunchPeople: 1, dinnerPeople: 0 })));
    await saveSiteDays(db, planner, a.userId, { winterthur: [4, 5] }); // a works here only on Thursdays and Fridays
    await saveSiteDays(db, planner, b.userId, { winterthur: [2, 3] });
    expect((await getSiteDays(db, [a.userId])).get(a.userId)?.get('winterthur')).toEqual([4, 5]);
    await expect(saveSiteDays(db, a, a.userId, { winterthur: [1] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const r = await suggestWeek(db, planner, 'winterthur', week, now);
    const rows = (await db.select().from(shifts)).filter((x) => x.workDate >= week && x.workDate <= '2027-06-13');
    // a only Thu/Fri, b only Tue/Wed; the other days stay empty (nobody else is available)
    for (const x of rows) {
      const day = new Date(`${x.workDate}T00:00:00Z`).getUTCDay();
      if (x.userId === a.userId) expect([4, 5]).toContain(day);
      if (x.userId === b.userId) expect([2, 3]).toContain(day);
    }
    expect(r.created).toBe(4);
    expect(r.gaps.length).toBe(3);
    // planning someone on another weekday is a warning in the week view
    await saveShift(db, planner, { site: 'winterthur', date: '2027-06-14', userId: a.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    const view = await getWeekView(db, planner, 'winterthur', '2027-06-14');
    expect(view.violations.some((v) => v.code === 'SITE_DAY' && v.userId === a.userId)).toBe(true);
    // all seven days = no restriction
    await saveSiteDays(db, planner, a.userId, { winterthur: [1, 2, 3, 4, 5, 6, 7] });
    expect((await getSiteDays(db, [a.userId])).get(a.userId)?.get('winterthur')).toBeUndefined();
  });

  it('suggesting a week that is partly planned keeps what is there and fills only the rest', async () => {
    const week = '2027-08-02';
    await saveSiteDays(db, planner, a.userId, { winterthur: [1, 2, 3, 4, 5, 6, 7] });
    await saveSiteDays(db, planner, b.userId, { winterthur: [1, 2, 3, 4, 5, 6, 7] });
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, (_, i) => (i < 5 ? { lunchPeople: 1, dinnerPeople: 1 } : { lunchPeople: 0, dinnerPeople: 0 })));
    // the Leitung already put b on Monday for the whole day by hand
    await saveShift(db, planner, { site: 'winterthur', date: '2027-08-02', userId: b.userId, startMin: t('10:30'), endMin: t('22:00'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    const r = await suggestWeek(db, planner, 'winterthur', week, now);
    const rows = (await db.select().from(shifts)).filter((x) => x.workDate >= week && x.workDate <= '2027-08-08');
    // Monday lunch and dinner are already covered by that shift: nobody else is added on Monday
    expect(rows.filter((x) => x.workDate === '2027-08-02')).toHaveLength(1);
    expect(r.created).toBe(rows.length - 1); // everything else was filled (Tuesday to Friday)
    expect(r.gaps).toEqual([]);
    expect((await suggestWeek(db, planner, 'winterthur', week, now)).created).toBe(0);
  });

  it('copying last week leaves out people who are leaving; every shift gets its break', async () => {
    const prev = '2027-09-06';
    await saveSiteDays(db, planner, a.userId, { winterthur: [1, 2, 3, 4, 5, 6, 7] });
    await saveSiteDays(db, planner, b.userId, { winterthur: [1, 2, 3, 4, 5, 6, 7] });
    // a long shift gets the legal break by itself (10:30–22:00 = 11.5 h: 60 min), a short one needs none
    const longId = await saveShift(db, planner, { site: 'winterthur', date: '2027-09-06', userId: a.userId, startMin: t('10:30'), endMin: t('22:00'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    await saveShift(db, planner, { site: 'winterthur', date: '2027-09-07', userId: b.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    await saveShift(db, planner, { site: 'winterthur', date: '2027-09-08', userId: a.userId, startMin: t('17:30'), endMin: t('22:00'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now);
    expect((await db.select().from(shifts).where(eq(shifts.id, longId)))[0]!.breakMin).toBe(60);
    // a is leaving: last day is the Wednesday of that week, so copying into next week leaves a out
    await saveProfile(db, planner, a.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true, lastDay: '2027-09-08' });
    await expect(saveShift(db, planner, { site: 'winterthur', date: '2027-09-14', userId: a.userId, startMin: t('10:30'), endMin: t('14:30'), breakMin: 0, station: 'EG Thai', roleLabel: null }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const n = await copyWeek(db, planner, 'winterthur', '2027-09-13', now);
    expect(n).toBe(1); // only b's shift
    const copied = (await db.select().from(shifts)).filter((x) => x.workDate >= '2027-09-13' && x.workDate <= '2027-09-19');
    expect(copied.every((x) => x.userId === b.userId)).toBe(true);
    // the suggestion does not offer a after the last day either
    await saveNeeds(db, planner, 'winterthur', Array.from({ length: 7 }, (_, i) => (i === 1 ? { lunchPeople: 2, dinnerPeople: 0 } : { lunchPeople: 0, dinnerPeople: 0 })));
    await suggestWeek(db, planner, 'winterthur', '2027-09-13', now);
    expect((await db.select().from(shifts)).filter((x) => x.workDate >= '2027-09-13' && x.workDate <= '2027-09-19').some((x) => x.userId === a.userId)).toBe(false);
    expect(prev).toBe('2027-09-06');
  });

  it('warns in the week of the last Sunday when somebody with a Pensum has no Sunday that month', async () => {
    const week = '2027-10-25'; // Sunday 31 Oct 2027 is the last one of the month
    const hasWarn = async () => (await getWeekView(db, planner, 'winterthur', week)).violations.some((v) => v.code === 'SUNDAY' && v.userId === b.userId);
    expect(await hasWarn()).toBe(true);
    await saveShift(db, planner, { site: 'winterthur', date: '2027-10-17', userId: b.userId, startMin: t('11:00'), endMin: t('16:00'), breakMin: 0, station: 'Sonntag OG', roleLabel: null }, now); // Sunday 17 Oct
    expect(await hasWarn()).toBe(false);
    // somebody who works at the site only on weekdays is not asked for a Sunday
    await saveSiteDays(db, planner, a.userId, { winterthur: [1, 2, 3, 4, 5] });
    expect((await getWeekView(db, planner, 'winterthur', week)).violations.some((v) => v.code === 'SUNDAY' && v.userId === a.userId)).toBe(false);
    // the weeks before the last Sunday do not warn
    expect((await getWeekView(db, planner, 'winterthur', '2027-10-18')).violations.some((v) => v.code === 'SUNDAY')).toBe(false);
  });
});
