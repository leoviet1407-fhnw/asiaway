import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  assertUsableWindow,
  canTransition,
  comparePlanned,
  totalWorkedMinutes,
  workedMinutes,
} from '../../src/domain/roster/timesheet';

const at = (iso: string) => new Date(iso);

describe('worked minutes', () => {
  it('is time on the floor less the break', () => {
    expect(
      workedMinutes({
        clockInAt: at('2026-10-01T10:30:00Z'),
        clockOutAt: at('2026-10-01T14:30:00Z'),
        breakMinutes: 30,
      }),
    ).toBe(210);
  });

  it('counts a running entry as nothing', () => {
    // Counting it to "now" would make a timesheet that changes every time it
    // is read, and a month that never settles.
    expect(
      workedMinutes({ clockInAt: at('2026-10-01T10:30:00Z'), clockOutAt: null, breakMinutes: 0 }),
    ).toBe(0);
  });

  it('never goes negative when the break swallows the shift', () => {
    expect(
      workedMinutes({
        clockInAt: at('2026-10-01T10:00:00Z'),
        clockOutAt: at('2026-10-01T10:30:00Z'),
        breakMinutes: 90,
      }),
    ).toBe(0);
  });

  it('sums a day of split shifts', () => {
    const total = totalWorkedMinutes([
      { clockInAt: at('2026-10-01T10:30:00Z'), clockOutAt: at('2026-10-01T14:30:00Z'), breakMinutes: 0 },
      { clockInAt: at('2026-10-01T17:30:00Z'), clockOutAt: at('2026-10-01T22:00:00Z'), breakMinutes: 0 },
    ]);
    expect(total).toBe(510); // 8 h 30
  });

  it('measures real elapsed time across a clock change', () => {
    // 00:30 to 03:30 Zurich on 25.10.2026 is four hours actually worked.
    expect(
      workedMinutes({
        clockInAt: at('2026-10-24T22:30:00Z'),
        clockOutAt: at('2026-10-25T02:30:00Z'),
        breakMinutes: 0,
      }),
    ).toBe(240);
  });
});

describe('planned against worked', () => {
  it('reports the variance, signed', () => {
    expect(comparePlanned(480, 510)).toMatchObject({ varianceMinutes: 30 });
    expect(comparePlanned(480, 450)).toMatchObject({ varianceMinutes: -30 });
    expect(comparePlanned(480, 480).varianceMinutes).toBe(0);
  });

  it('is a scheduling fact, not a balance', () => {
    // Deliberately no notion of what anyone is owed: that needs a pay rule,
    // and no pay rule has been chosen (Part 9 of the plan).
    const result = comparePlanned(480, 510);
    expect(Object.keys(result).sort()).toEqual([
      'plannedMinutes',
      'varianceMinutes',
      'workedMinutes',
    ]);
  });
});

describe('what counts as a usable entry', () => {
  const start = at('2026-10-01T10:00:00Z');

  it('accepts an ordinary shift, and one still running', () => {
    expect(() => assertUsableWindow(start, at('2026-10-01T18:00:00Z'), 30)).not.toThrow();
    expect(() => assertUsableWindow(start, null, 0)).not.toThrow();
  });

  it('refuses an end before the start', () => {
    expect(() => assertUsableWindow(start, at('2026-10-01T09:00:00Z'), 0)).toThrow(/after its start/i);
  });

  it('refuses a break as long as the shift', () => {
    expect(() => assertUsableWindow(start, at('2026-10-01T14:00:00Z'), 240)).toThrow(/as long as/i);
  });

  it('says plainly when someone clocked out seconds after clocking in', () => {
    // A zero break against a zero-minute shift would otherwise report "the
    // break cannot be as long as the shift", which explains nothing.
    expect(() => assertUsableWindow(start, at('2026-10-01T10:00:20Z'), 0)).toThrow(/under a minute/i);
  });

  it('refuses a negative break', () => {
    expect(() => assertUsableWindow(start, at('2026-10-01T14:00:00Z'), -5)).toThrow(/negative/i);
  });

  it('refuses anything over 16 hours, which is a forgotten clock-out', () => {
    expect(() => assertUsableWindow(start, at('2026-10-02T04:00:00Z'), 0)).toThrow(/16 hours/i);
    // Just under stays allowed; a long Saturday is a real thing.
    expect(() => assertUsableWindow(start, at('2026-10-02T01:59:00Z'), 0)).not.toThrow();
  });
});

describe('the entry lifecycle', () => {
  it('runs open → submitted → approved', () => {
    expect(canTransition('OPEN', 'SUBMITTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'APPROVED')).toBe(true);
  });

  it('lets an employee dispute recorded hours', () => {
    expect(canTransition('SUBMITTED', 'DISPUTED')).toBe(true);
    expect(canTransition('APPROVED', 'DISPUTED')).toBe(true);
  });

  it('lets a correction reopen an approved entry', () => {
    // A payslip defended with the wrong hours is worse than one corrected late.
    expect(canTransition('APPROVED', 'SUBMITTED')).toBe(true);
  });

  it('refuses to approve something still running', () => {
    expect(canTransition('OPEN', 'APPROVED')).toBe(false);
    expect(() => assertTransition('OPEN', 'APPROVED')).toThrow(/cannot become approved/i);
  });

  it('refuses to reopen an entry that was never finished', () => {
    expect(canTransition('SUBMITTED', 'OPEN')).toBe(false);
  });
});
