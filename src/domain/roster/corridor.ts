import { domainError } from '../errors';

/**
 * How many hours a person owes, derived from the percentage on their contract.
 *
 * An Asiaway contract states a PERCENTAGE — 100%, 80%, 70% — and never a number
 * of hours. The house basis for 100% is itself a range, 40–42.5 h/week, so the
 * target is a corridor rather than a figure:
 *
 *   corridor = pensum_percent x [weekly_min, weekly_max]
 *
 * Inside the corridor there is no deviation at all. Only hours past an edge
 * count as over or under. This is what makes the September 2026 roster read as
 * well-calibrated — six people, three pensum levels, every one of them inside —
 * rather than as six separate rounding errors.
 *
 * The corridor drives PLANNING WARNINGS ONLY. It is deliberately not a pay rule:
 * whether hours inside it are settled by salary or carried forward is a business
 * decision that has been deferred, so nothing here may quietly decide it.
 * See Part 9 of docs/ASIAWAY_PHASE2_WORKFORCE_PLAN.md.
 *
 * Everything is integer minutes, for the same reason money is integer Rappen:
 * a target that drifts by a floating-point hair is a target nobody trusts.
 */

/** Minutes, inclusive at both ends. */
export interface Corridor {
  readonly minMinutes: number;
  readonly maxMinutes: number;
}

export interface WorkTimePolicy {
  /** Hours per week at 100%, lower edge. e.g. 40 */
  readonly weeklyHoursMinAt100: number;
  /** Hours per week at 100%, upper edge. e.g. 42.5 */
  readonly weeklyHoursMaxAt100: number;
}

export type CorridorVerdict = 'UNDER' | 'INSIDE' | 'OVER';

const MINUTES_PER_HOUR = 60;
const DAYS_PER_WEEK = 7;

/**
 * Scales hours to a pensum in integer minutes.
 *
 * Converted to minutes BEFORE the percentage is applied: 42.5 h at 70% is
 * 2550 x 70 / 100 = 1785 minutes exactly, where 42.5 * 0.7 * 60 goes through
 * 29.749999999999996 and needs rounding to land in the same place.
 */
function scaleToPensum(hours: number, pensumPercent: number): number {
  return Math.round((hours * MINUTES_PER_HOUR * pensumPercent) / 100);
}

/** The weekly corridor for one pensum. */
export function weeklyCorridor(policy: WorkTimePolicy, pensumPercent: number): Corridor {
  if (!(pensumPercent > 0) || pensumPercent > 100) {
    throw domainError('INVALID_PENSUM', `Pensum must be in (0, 100]; got ${pensumPercent}.`);
  }
  if (policy.weeklyHoursMinAt100 > policy.weeklyHoursMaxAt100) {
    throw domainError('INVALID_WORK_TIME_POLICY', 'The weekly corridor is inverted.');
  }
  return {
    minMinutes: scaleToPensum(policy.weeklyHoursMinAt100, pensumPercent),
    maxMinutes: scaleToPensum(policy.weeklyHoursMaxAt100, pensumPercent),
  };
}

/**
 * The corridor for a roster period of `days` calendar days.
 *
 * Scaled by days/7 — a 30-day month is 4.2857 weeks. **OPEN (Q2 of the plan):**
 * whether the monthly target should instead be calendar-derived from scheduled
 * working days, or a fixed monthly figure, is undecided. This is the neutral
 * reading and the one place that would change.
 */
export function periodCorridor(
  policy: WorkTimePolicy,
  pensumPercent: number,
  days: number,
): Corridor {
  if (!Number.isInteger(days) || days <= 0) {
    throw domainError('INVALID_PERIOD', `A roster period must span whole days; got ${days}.`);
  }
  const weekly = weeklyCorridor(policy, pensumPercent);
  return {
    minMinutes: Math.round((weekly.minMinutes * days) / DAYS_PER_WEEK),
    maxMinutes: Math.round((weekly.maxMinutes * days) / DAYS_PER_WEEK),
  };
}

export function corridorVerdict(workedMinutes: number, corridor: Corridor): CorridorVerdict {
  if (workedMinutes < corridor.minMinutes) return 'UNDER';
  if (workedMinutes > corridor.maxMinutes) return 'OVER';
  return 'INSIDE';
}

/**
 * Signed minutes past the nearest edge; exactly 0 anywhere inside.
 *
 * Note what this is NOT: a balance. A balance says what someone is owed, which
 * needs a pay rule. This says only how far outside their planned corridor they
 * are, which is a scheduling fact.
 */
export function corridorDeviationMinutes(workedMinutes: number, corridor: Corridor): number {
  if (workedMinutes < corridor.minMinutes) return workedMinutes - corridor.minMinutes;
  if (workedMinutes > corridor.maxMinutes) return workedMinutes - corridor.maxMinutes;
  return 0;
}
