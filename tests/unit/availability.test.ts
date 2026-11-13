import { describe, expect, it } from 'vitest';
import {
  STANDARD_DAY_MINUTES,
  coverageState,
  needHours,
  needsFromShifts,
  offerCovers,
  offeredMinutes,
  weekStatus,
  weeksOfMonth,
  weeksToCheck,
  LUNCH_WINDOW,
  DINNER_WINDOW,
} from '@/domain/availability';
import { parseTime, type AvailabilityDay } from '@/domain/roster';

const t = (s: string) => parseTime(s)!;
const day = (date: string, kind: 'AVAILABLE' | 'UNAVAILABLE', from?: string, to?: string): AvailabilityDay => ({
  userId: 'u', date, kind, fromMin: from ? t(from) : null, toMin: to ? t(to) : null,
});
const WEEK = '2026-12-14'; // Monday

describe('hours offered against the contract', () => {
  it('a whole day is a standard day of 8.5 h, a window counts its own length, "free" counts nothing', () => {
    expect(STANDARD_DAY_MINUTES).toBe(510);
    expect(offeredMinutes(day(WEEK, 'AVAILABLE'))).toBe(510);
    expect(offeredMinutes(day(WEEK, 'AVAILABLE', '10:30', '14:30'))).toBe(240);
    expect(offeredMinutes(day(WEEK, 'UNAVAILABLE'))).toBe(0);
    expect(offeredMinutes(undefined)).toBe(0);
  });

  it('five whole days make exactly 42.5 h: enough for 100 %', () => {
    const days = ['14', '15', '16', '17', '18'].map((d) => day(`2026-12-${d}`, 'AVAILABLE'));
    const s = weekStatus({ weekStart: WEEK, pensumPercent: 100, availability: days, absences: [] });
    expect(s).toMatchObject({ offeredMinutes: 2550, requiredMinutes: 2550, ok: true, missingMinutes: 0 });
  });

  it('four whole days are enough for 80 % (34 h) but not for 100 %', () => {
    const days = ['14', '15', '16', '17'].map((d) => day(`2026-12-${d}`, 'AVAILABLE'));
    expect(weekStatus({ weekStart: WEEK, pensumPercent: 80, availability: days, absences: [] }).ok).toBe(true);
    const hundred = weekStatus({ weekStart: WEEK, pensumPercent: 100, availability: days, absences: [] });
    expect(hundred.ok).toBe(false);
    expect(hundred.missingMinutes).toBe(2550 - 4 * 510);
  });

  it('holiday and sick weekdays count as standard days; weekends do not', () => {
    const s = weekStatus({
      weekStart: WEEK,
      pensumPercent: 100,
      availability: [day('2026-12-14', 'AVAILABLE')],
      absences: [{ startDate: '2026-12-15', endDate: '2026-12-20', type: 'VACATION' }],
    });
    expect(s.creditMinutes).toBe(4 * 510); // Tue–Fri; Sat and Sun are not credited
    expect(s.ok).toBe(true);
    expect(weekStatus({ weekStart: WEEK, pensumPercent: 100, availability: [], absences: [{ startDate: '2026-12-15', endDate: '2026-12-15', type: 'OTHER' }] }).creditMinutes).toBe(0);
  });

  it('people without a pensum have no minimum', () => {
    const s = weekStatus({ weekStart: WEEK, pensumPercent: null, availability: [], absences: [] });
    expect(s).toMatchObject({ requiredMinutes: null, ok: true });
  });

  it('every week belongs to exactly one month, and only fully open weeks are checked', () => {
    expect(weeksOfMonth('2026-12')).toEqual(['2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28']);
    expect(weeksOfMonth('2027-01')).toEqual(['2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25']);
    expect(weeksToCheck('2026-12', '2026-12-11')).toEqual(['2026-12-14', '2026-12-21', '2026-12-28']);
  });
});

describe('staffing need and coverage', () => {
  it('a whole day covers both services, a window only the service it overlaps', () => {
    expect(offerCovers(day(WEEK, 'AVAILABLE'), LUNCH_WINDOW)).toBe(true);
    expect(offerCovers(day(WEEK, 'AVAILABLE'), DINNER_WINDOW)).toBe(true);
    expect(offerCovers(day(WEEK, 'AVAILABLE', '17:00', '22:00'), LUNCH_WINDOW)).toBe(false);
    expect(offerCovers(day(WEEK, 'AVAILABLE', '17:00', '22:00'), DINNER_WINDOW)).toBe(true);
    expect(offerCovers(day(WEEK, 'UNAVAILABLE'), LUNCH_WINDOW)).toBe(false);
  });

  it('states: gap, just enough, plenty, nothing needed', () => {
    expect(coverageState(3, 2)).toBe('gap');
    expect(coverageState(3, 3)).toBe('tight');
    expect(coverageState(3, 5)).toBe('ok');
    expect(coverageState(0, 4)).toBe('none');
  });

  it('works out the need from a planned week', () => {
    const shifts = [
      { date: '2026-12-14', userId: 'a', startMin: t('10:30'), endMin: t('14:30') },
      { date: '2026-12-14', userId: 'b', startMin: t('12:00'), endMin: t('17:00') },
      { date: '2026-12-14', userId: 'b', startMin: t('18:00'), endMin: t('22:00') },
      { date: '2026-12-14', userId: 'c', startMin: t('18:00'), endMin: t('22:00') },
      { date: '2026-12-14', userId: null, startMin: t('10:30'), endMin: t('14:30') }, // open shift: nobody yet
    ];
    const needs = needsFromShifts(shifts, WEEK);
    expect(needs[0]).toEqual({ lunchPeople: 2, dinnerPeople: 2 });
    expect(needs[1]).toEqual({ lunchPeople: 0, dinnerPeople: 0 });
    expect(needHours([{ lunchPeople: 2, dinnerPeople: 2 }])).toBe(2 * 4 + 2 * 4.5);
  });
});
