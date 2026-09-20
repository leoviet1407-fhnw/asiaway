import { describe, expect, it } from 'vitest';
import {
  corridorDeviationMinutes,
  corridorVerdict,
  periodCorridor,
  weeklyCorridor,
  type WorkTimePolicy,
} from '../../src/domain/roster/corridor';
import { availabilityWeight, hasHoursTarget } from '../../src/domain/roster/availability';

/** Confirmed by the restaurant, 2026-09-20. Seeded by migration 0008. */
const POLICY: WorkTimePolicy = { weeklyHoursMinAt100: 40, weeklyHoursMaxAt100: 42.5 };

const h = (hours: number) => Math.round(hours * 60);

describe('the weekly corridor', () => {
  it('is the full band at 100%', () => {
    expect(weeklyCorridor(POLICY, 100)).toEqual({ minMinutes: h(40), maxMinutes: h(42.5) });
  });

  it('scales exactly at 80% and 70% — no floating-point drift', () => {
    // 42.5 * 0.7 evaluates to 29.749999999999996 in binary floating point.
    // Scaling in minutes keeps it at 1785 exactly.
    expect(weeklyCorridor(POLICY, 80)).toEqual({ minMinutes: 1920, maxMinutes: 2040 });
    expect(weeklyCorridor(POLICY, 70)).toEqual({ minMinutes: 1680, maxMinutes: 1785 });
  });

  it('rejects a pensum outside (0, 100]', () => {
    expect(() => weeklyCorridor(POLICY, 0)).toThrow(/Pensum/);
    expect(() => weeklyCorridor(POLICY, 120)).toThrow(/Pensum/);
  });

  it('rejects an inverted policy rather than silently returning an empty band', () => {
    expect(() =>
      weeklyCorridor({ weeklyHoursMinAt100: 42.5, weeklyHoursMaxAt100: 40 }, 100),
    ).toThrow(/inverted/);
  });
});

describe('the week of 07.09.2026, as actually planned', () => {
  // Planned hours recomputed from the PDF with the confirmed 22:00 close.
  const planned = [
    { who: 'APRIL', pensum: 100, hours: 42.0 },
    { who: 'MERSI', pensum: 100, hours: 40.5 },
    { who: 'EDMOND', pensum: 100, hours: 41.5 },
    { who: 'TAMIE', pensum: 80, hours: 32.0 },
    { who: 'PHUOC', pensum: 80, hours: 32.5 },
    { who: 'YEN', pensum: 70, hours: 28.5 },
  ] as const;

  it.each(planned)('puts $who inside their corridor', ({ pensum, hours }) => {
    const corridor = weeklyCorridor(POLICY, pensum);
    expect(corridorVerdict(h(hours), corridor)).toBe('INSIDE');
    expect(corridorDeviationMinutes(h(hours), corridor)).toBe(0);
  });

  it('puts TAMIE exactly on her floor, with no slack left', () => {
    const corridor = weeklyCorridor(POLICY, 80);
    expect(h(32.0)).toBe(corridor.minMinutes);
    // Half an hour trimmed anywhere in her week drops her under contract.
    expect(corridorVerdict(h(31.5), corridor)).toBe('UNDER');
    expect(corridorDeviationMinutes(h(31.5), corridor)).toBe(-30);
  });
});

describe('the verdict at the edges', () => {
  const corridor = weeklyCorridor(POLICY, 100); // 2400 – 2550

  it('treats both edges as inside', () => {
    expect(corridorVerdict(2400, corridor)).toBe('INSIDE');
    expect(corridorVerdict(2550, corridor)).toBe('INSIDE');
  });

  it('reports a deviation only past an edge, signed', () => {
    expect(corridorDeviationMinutes(2399, corridor)).toBe(-1);
    expect(corridorDeviationMinutes(2551, corridor)).toBe(1);
    expect(corridorDeviationMinutes(2475, corridor)).toBe(0);
  });

  it('absorbs the width of the band — which is the point, and the cost', () => {
    // 2.5 h/week of real variation produces no signal at all. Deliberate, and
    // the reason pay cannot be derived from this without a stated rule.
    expect(corridorDeviationMinutes(2400, corridor)).toBe(0);
    expect(corridorDeviationMinutes(2550, corridor)).toBe(0);
    expect(corridor.maxMinutes - corridor.minMinutes).toBe(150);
  });
});

describe('a roster period longer than a week', () => {
  it('scales by calendar days', () => {
    expect(periodCorridor(POLICY, 100, 7)).toEqual(weeklyCorridor(POLICY, 100));
  });

  it("scales APRIL's 100% to the month's actual length", () => {
    // Per calendar day, so a 30-day and a 31-day month differ. The plan quotes
    // 173.8–184.7 h for an average month (4.345 weeks); neither of these is
    // that, and that is correct — a real period has a real number of days.
    const sep = periodCorridor(POLICY, 100, 30);
    expect(sep).toEqual({ minMinutes: 10286, maxMinutes: 10929 }); // 171.4 – 182.2 h
    const oct = periodCorridor(POLICY, 100, 31);
    expect(oct).toEqual({ minMinutes: 10629, maxMinutes: 11293 }); // 177.2 – 188.2 h
    expect(oct.minMinutes).toBeGreaterThan(sep.minMinutes);
  });

  it('rejects a non-whole-day period', () => {
    expect(() => periodCorridor(POLICY, 100, 0)).toThrow(/whole days/);
    expect(() => periodCorridor(POLICY, 100, 7.5)).toThrow(/whole days/);
  });
});

describe('what an availability row obliges the planner to do', () => {
  it('binds the planner for an Aushilfe — it is the only route onto the roster', () => {
    expect(availabilityWeight('ON_CALL')).toBe('BINDING');
    expect(hasHoursTarget('ON_CALL')).toBe(false);
  });

  it('is advisory where the contract already obliges the hours', () => {
    expect(availabilityWeight('FULL_TIME')).toBe('ADVISORY');
    expect(availabilityWeight('PART_TIME')).toBe('ADVISORY');
    expect(hasHoursTarget('PART_TIME')).toBe(true);
  });
});
