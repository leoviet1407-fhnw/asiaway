import { describe, expect, it } from 'vitest';
import {
  isAvailableOnWeekday,
  isSaturday,
  isSaturdayDate,
  nextSaturday,
  restaurantDate,
  restaurantWeekday,
  weekdayOfDate,
} from '../../src/domain/menu/saturday';

/** 2026-09-19 is a Saturday; 2026-09-20 a Sunday. */
const SATURDAY_NOON_UTC = new Date('2026-09-19T12:00:00Z');

describe('the restaurant’s own day', () => {
  it('reads the weekday in Zurich, not UTC', () => {
    expect(restaurantWeekday(SATURDAY_NOON_UTC)).toBe(6);
    expect(isSaturday(SATURDAY_NOON_UTC)).toBe(true);
  });

  it('still says Saturday late on a Saturday evening, when UTC has moved on', () => {
    // 22:30 UTC on Saturday is 00:30 on Sunday in Zurich (summer time) — the
    // restaurant is shut, and the date must follow Zurich, not UTC.
    const lateSaturdayUtc = new Date('2026-09-19T22:30:00Z');
    expect(restaurantDate(lateSaturdayUtc)).toBe('2026-09-20');
    expect(isSaturday(lateSaturdayUtc)).toBe(false);
  });

  it('says Saturday during Saturday service, when UTC is still on Saturday', () => {
    // 19:00 Zurich on a Saturday, mid-service.
    const duringService = new Date('2026-09-19T17:00:00Z');
    expect(restaurantDate(duringService)).toBe('2026-09-19');
    expect(isSaturday(duringService)).toBe(true);
  });

  it('is not caught out by the clocks changing', () => {
    // Swiss clocks go back on 2026-10-25. An hour either side of the change
    // must still be the same local date.
    expect(restaurantDate(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    expect(restaurantDate(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25');
  });

  it('reads a plain date without a time zone', () => {
    expect(weekdayOfDate('2026-09-19')).toBe(6);
    expect(weekdayOfDate('2026-09-20')).toBe(7);
    expect(weekdayOfDate('2026-09-21')).toBe(1);
    expect(isSaturdayDate('2026-09-19')).toBe(true);
    expect(isSaturdayDate('2026-09-18')).toBe(false);
  });
});

describe('which dishes are sold today', () => {
  it('sells a dish with no restriction on any day', () => {
    for (let day = 1; day <= 7; day += 1) {
      expect(isAvailableOnWeekday(null, day), `day ${day}`).toBe(true);
      expect(isAvailableOnWeekday([], day), `day ${day}`).toBe(true);
    }
  });

  it('sells a Saturday dish only on Saturday', () => {
    expect(isAvailableOnWeekday([6], 6)).toBe(true);
    for (const day of [1, 2, 3, 4, 5, 7]) {
      expect(isAvailableOnWeekday([6], day), `day ${day}`).toBe(false);
    }
  });
});

describe('the Saturday being prepared for', () => {
  it('is today when today is Saturday', () => {
    expect(nextSaturday('2026-09-19')).toBe('2026-09-19');
  });

  it('is the coming Saturday on any other day', () => {
    expect(nextSaturday('2026-09-20')).toBe('2026-09-26'); // Sunday
    expect(nextSaturday('2026-09-21')).toBe('2026-09-26'); // Monday
    expect(nextSaturday('2026-09-25')).toBe('2026-09-26'); // Friday
  });

  it('crosses a month and a year end', () => {
    expect(nextSaturday('2026-10-29')).toBe('2026-10-31');
    expect(nextSaturday('2026-12-28')).toBe('2027-01-02');
  });

  it('always lands on a Saturday', () => {
    // Every day of a leap year, because an off-by-one here silently puts the
    // special on a day nothing will show it.
    const start = Date.UTC(2028, 0, 1, 12);
    for (let i = 0; i < 366; i += 1) {
      const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      expect(weekdayOfDate(nextSaturday(day)), day).toBe(6);
    }
  });
});
