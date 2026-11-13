/**
 * "Plan vorschlagen": a first draft of a week from the staffing need and what people offered.
 * It fills Lunch and Dinner per day, favours people who are furthest below their contract and
 * gives people both services of a day when they can. The Leitung then corrects the draft.
 * Pure function, no database.
 */
import { LUNCH_WINDOW, DINNER_WINDOW, offerCovers, type DayNeed } from './availability';
import { weeklyMinutes } from './hours';
import { weekDates, type AvailabilityDay, type EmploymentType } from './roster';

export interface SuggestPerson {
  readonly userId: string;
  readonly name: string;
  readonly employmentType: EmploymentType;
  readonly pensumPercent: number | null;
  /** Minutes the person is already planned this week (e.g. at the other site). */
  readonly plannedMinutes: number;
}

export interface SuggestedShift {
  userId: string;
  date: string;
  startMin: number;
  endMin: number;
  service: 'LUNCH' | 'DINNER';
}

export interface SuggestGap {
  date: string;
  service: 'LUNCH' | 'DINNER';
  missing: number;
}

const MIN_SHIFT = 180;

export function suggestShifts(input: {
  weekStart: string;
  people: readonly SuggestPerson[];
  /** Seven days, special days already applied. */
  needs: readonly DayNeed[];
  /** What each person can do per day (their own entry or their weekly pattern). */
  offers: readonly AvailabilityDay[];
  /** People away on a date. */
  away: (userId: string, date: string) => boolean;
}): { shifts: SuggestedShift[]; gaps: SuggestGap[] } {
  const minutes = new Map(input.people.map((p) => [p.userId, p.plannedMinutes]));
  const target = (p: SuggestPerson) => (p.pensumPercent && (p.employmentType === 'FULL_TIME' || p.employmentType === 'PART_TIME') ? weeklyMinutes(p.pensumPercent) : null);
  const shifts: SuggestedShift[] = [];
  const gaps: SuggestGap[] = [];
  const today = new Map<string, Set<string>>(); // date -> people already planned that day

  weekDates(input.weekStart).forEach((date, i) => {
    const need = input.needs[i] ?? { lunchPeople: 0, dinnerPeople: 0 };
    for (const service of ['LUNCH', 'DINNER'] as const) {
      const window = service === 'LUNCH' ? LUNCH_WINDOW : DINNER_WINDOW;
      const wanted = service === 'LUNCH' ? need.lunchPeople : need.dinnerPeople;
      if (wanted <= 0) continue;
      const planned = (today.get(date) ?? new Set<string>());
      const chosen: string[] = [];
      for (const pass of ['contract', 'any'] as const) {
        while (chosen.length < wanted) {
          const candidates = input.people
            .map((p) => {
              if (chosen.includes(p.userId) || input.away(p.userId, date)) return null;
              const offer = input.offers.find((o) => o.userId === p.userId && o.date === date);
              if (!offer || !offerCovers(offer, window)) return null;
              const start = Math.max(window.fromMin, offer.fromMin ?? window.fromMin);
              const end = Math.min(window.toMin, offer.toMin ?? window.toMin);
              if (end - start < MIN_SHIFT) return null;
              const t = target(p);
              const left = t === null ? Number.POSITIVE_INFINITY : t - (minutes.get(p.userId) ?? 0);
              if (pass === 'contract' && (t === null || left < end - start - 30)) return null;
              return { p, start, end, left: t === null ? -1 : left, hasToday: planned.has(p.userId) };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null)
            // already working today first (one block of the day), then the most hours still owed; casual staff last
            .sort((a, b) => Number(b.hasToday) - Number(a.hasToday) || b.left - a.left || a.p.name.localeCompare(b.p.name));
          const pick = candidates[0];
          if (!pick) break;
          chosen.push(pick.p.userId);
          planned.add(pick.p.userId);
          minutes.set(pick.p.userId, (minutes.get(pick.p.userId) ?? 0) + (pick.end - pick.start));
          shifts.push({ userId: pick.p.userId, date, startMin: pick.start, endMin: pick.end, service });
        }
        if (chosen.length >= wanted) break;
      }
      today.set(date, planned);
      if (chosen.length < wanted) gaps.push({ date, service, missing: wanted - chosen.length });
    }
  });
  return { shifts, gaps };
}
