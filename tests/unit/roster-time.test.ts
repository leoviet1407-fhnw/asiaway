import { describe, expect, it } from 'vitest';
import { localDateIn, localMinutesIn, zonedInstant } from '../../src/domain/roster/time';

const ZURICH = 'Europe/Zurich';

/**
 * Switzerland changes its clocks on the last Sunday of October — inside an
 * October roster period. Storing the wall clock as though it were UTC would
 * look right and put every shift after the change an hour away from the moment
 * it actually happens.
 */
describe('wall clock to instant, in the restaurant’s zone', () => {
  it('uses summer time before the change and winter time after it', () => {
    // 2026: the clocks go back on Sunday 25 October.
    expect(zonedInstant('2026-10-24', '22:00', ZURICH).toISOString()).toBe('2026-10-24T20:00:00.000Z');
    expect(zonedInstant('2026-10-26', '22:00', ZURICH).toISOString()).toBe('2026-10-26T21:00:00.000Z');
  });

  it('round-trips every day of the changeover week', () => {
    for (const day of ['22', '23', '24', '25', '26', '27', '28']) {
      const date = `2026-10-${day}`;
      const instant = zonedInstant(date, '17:30', ZURICH);
      expect(localDateIn(instant, ZURICH)).toBe(date);
      expect(localMinutesIn(instant, ZURICH)).toBe(17 * 60 + 30);
    }
  });

  it('counts the extra hour on the night the clocks go back', () => {
    const from = zonedInstant('2026-10-25', '00:30', ZURICH);
    const to = zonedInstant('2026-10-25', '03:30', ZURICH);
    // Three hours on the clock, four hours actually lived.
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(4);
  });

  it('resolves a time that does not exist rather than throwing', () => {
    // 2026: the clocks go forward on Sunday 29 March, so 02:30 never happens.
    // The restaurant is shut; a roster that refuses to save would be worse.
    expect(() => zonedInstant('2026-03-29', '02:30', ZURICH)).not.toThrow();
    expect(zonedInstant('2026-03-29', '02:30', ZURICH)).toBeInstanceOf(Date);
  });

  it('keeps a shift that ends after midnight on the day it started', () => {
    const end = zonedInstant('2026-09-12', '23:30', ZURICH);
    expect(localDateIn(end, ZURICH)).toBe('2026-09-12');
    expect(localMinutesIn(end, ZURICH)).toBe(23 * 60 + 30);
  });

  it('is the identity in UTC, which is why the rule fixtures can use it', () => {
    expect(zonedInstant('2026-09-07', '17:30', 'UTC').toISOString()).toBe('2026-09-07T17:30:00.000Z');
  });
});
