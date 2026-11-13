import { describe, expect, it } from 'vitest';
import { easterSunday, swissHolidays, vacationConflict, needFor } from '@/domain/season';
import { findGaps, suggestShifts } from '@/domain/suggest';
import type { AvailabilityDay } from '@/domain/roster';

describe('holiday season', () => {
  it('computes Easter and the Zürich holidays', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    const h = Object.fromEntries(swissHolidays(2026).map((x) => [x.label, x.date]));
    expect(h['Karfreitag']).toBe('2026-04-03');
    expect(h['Ostermontag']).toBe('2026-04-06');
    expect(h['Auffahrt']).toBe('2026-05-14');
    expect(h['Pfingstmontag']).toBe('2026-05-25');
    expect(h['Weihnachten']).toBe('2026-12-25');
  });

  it('a special day replaces the weekday need; closed means nobody', () => {
    const base = { lunchPeople: 3, dinnerPeople: 5 };
    expect(needFor(base, null)).toEqual(base);
    expect(needFor(base, { date: 'd', label: 'Silvester', closed: false, lunchPeople: 0, dinnerPeople: 8 })).toEqual({ lunchPeople: 0, dinnerPeople: 8 });
    expect(needFor(base, { date: 'd', label: 'Weihnachten', closed: true, lunchPeople: 2, dinnerPeople: 2 })).toEqual({ lunchPeople: 0, dinnerPeople: 0 });
  });

  it('blocks a holiday request on the first day the limit is full', () => {
    const rules = [{ label: 'Weihnachtszeit', startDate: '2026-12-20', endDate: '2027-01-02', maxPeople: 2 }];
    const others = [
      { userId: 'a', startDate: '2026-12-24', endDate: '2026-12-27' },
      { userId: 'b', startDate: '2026-12-25', endDate: '2026-12-31' },
    ];
    expect(vacationConflict({ rules, others, userId: 'c', startDate: '2026-12-21', endDate: '2026-12-23' })).toBeNull();
    expect(vacationConflict({ rules, others, userId: 'c', startDate: '2026-12-23', endDate: '2026-12-28' })).toMatchObject({ date: '2026-12-25', count: 2, max: 2 });
    expect(vacationConflict({ rules, others, userId: 'c', startDate: '2027-02-01', endDate: '2027-02-03' })).toBeNull();
  });
});

describe('roster suggestion', () => {
  const people = [
    { userId: 'full', name: 'Voll', employmentType: 'FULL_TIME' as const, pensumPercent: 100, plannedMinutes: 0 },
    { userId: 'part', name: 'Teil', employmentType: 'PART_TIME' as const, pensumPercent: 50, plannedMinutes: 0 },
    { userId: 'casual', name: 'Aushilfe', employmentType: 'ON_CALL' as const, pensumPercent: null, plannedMinutes: 0 },
  ];
  const week = '2026-11-09';
  const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
  const whole = (userId: string, date: string): AvailabilityDay => ({ userId, date, kind: 'AVAILABLE', fromMin: null, toMin: null });
  const needs = days.map((_, i) => (i < 5 ? { lunchPeople: 1, dinnerPeople: 1 } : { lunchPeople: 0, dinnerPeople: 0 }));

  it('fills Lunch and Dinner, keeps contracts and reports gaps', () => {
    const offers = days.slice(0, 5).flatMap((d) => [whole('full', d), whole('part', d)]);
    const { shifts, gaps } = suggestShifts({ weekStart: week, people, needs, offers, away: () => false });
    expect(gaps).toEqual([]);
    expect(shifts.filter((s) => s.service === 'LUNCH')).toHaveLength(5);
    expect(shifts.filter((s) => s.service === 'DINNER')).toHaveLength(5);
    const hours = (id: string) => shifts.filter((s) => s.userId === id).reduce((n, s) => n + (s.endMin - s.startMin), 0);
    expect(hours('part')).toBeLessThanOrEqual(21 * 60 + 45); // 50 % of 42.5 h, with the slack of one shift
    expect(shifts.some((s) => s.userId === 'casual')).toBe(false);
  });

  it('respects holidays, time windows and missing people', () => {
    const offers: AvailabilityDay[] = [
      { userId: 'full', date: days[0]!, kind: 'AVAILABLE', fromMin: 12 * 60, toMin: 14 * 60 + 30 }, // only 2.5 h: too short for a shift
      { userId: 'part', date: days[1]!, kind: 'AVAILABLE', fromMin: 17 * 60 + 30, toMin: 22 * 60 },
      { userId: 'full', date: days[2]!, kind: 'AVAILABLE', fromMin: null, toMin: null },
    ];
    const { shifts, gaps } = suggestShifts({ weekStart: week, people, needs, offers, away: (u, d) => u === 'full' && d === days[2] });
    expect(shifts).toEqual([{ userId: 'part', date: days[1], startMin: 17 * 60 + 30, endMin: 22 * 60, service: 'DINNER' }]);
    expect(gaps.some((g) => g.date === days[0] && g.service === 'LUNCH')).toBe(true);
    expect(gaps.some((g) => g.date === days[2])).toBe(true); // on holiday
  });

  it('uses a person\'s usual times and lets a long block cover both services', () => {
    const usual = [
      { ...people[0]!, usualFromMin: 12 * 60, usualToMin: 21 * 60 }, // 12:00–21:00 covers lunch and dinner
      { userId: 'yen', name: 'Yen', employmentType: 'PART_TIME' as const, pensumPercent: 70, plannedMinutes: 0, usualFromMin: 17 * 60, usualToMin: 21 * 60 + 30 },
    ];
    const offers = [whole('full', days[0]!), whole('yen', days[0]!)];
    const one = [{ lunchPeople: 1, dinnerPeople: 2 }, ...needs.slice(1).map(() => ({ lunchPeople: 0, dinnerPeople: 0 }))];
    const { shifts, gaps } = suggestShifts({ weekStart: week, people: usual, needs: one, offers, away: () => false });
    expect(shifts).toEqual([
      { userId: 'full', date: days[0], startMin: 12 * 60, endMin: 21 * 60, service: 'LUNCH' },
      { userId: 'yen', date: days[0], startMin: 17 * 60, endMin: 21 * 60 + 30, service: 'DINNER' },
    ]);
    expect(gaps).toEqual([]);
  });

  it('lists who can fill a gap, most useful first', () => {
    const offers = [whole('full', days[0]!), whole('part', days[0]!), whole('casual', days[0]!)];
    const planned = [{ userId: 'full', date: days[0]!, startMin: 10 * 60 + 30, endMin: 14 * 60 + 30 }];
    const g = findGaps({ weekStart: week, people, needs: [{ lunchPeople: 1, dinnerPeople: 2 }, ...needs.slice(1).map(() => ({ lunchPeople: 0, dinnerPeople: 0 }))], offers, away: (u) => u === 'part', planned });
    expect(g).toHaveLength(1); // lunch is covered, dinner is short by 2
    expect(g[0]).toMatchObject({ date: days[0], service: 'DINNER', missing: 2 });
    expect(g[0]!.candidates.map((c) => c.userId)).toEqual(['full', 'casual']); // part is on holiday; full already works that day
  });
});
