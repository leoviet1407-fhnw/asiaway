/**
 * "Plan vorschlagen" and "Wer kann diese Lücke füllen?". Pure functions, no database.
 *
 * A draft fills Lunch and Dinner per day from the staffing need: people furthest below their
 * contract come first, people who already work that day take the second service too, and a
 * person's usual times (e.g. Yen 17:00–21:30) are used as they are. The Leitung then corrects it.
 */
import { LUNCH_WINDOW, DINNER_WINDOW, offerCovers, type DayNeed } from './availability';
import { weeklyMinutes } from './hours';
import { shiftNetMinutes, weekDates, type AvailabilityDay, type EmploymentType } from './roster';

export type Service = 'LUNCH' | 'DINNER';

export interface SuggestPerson {
  readonly userId: string;
  readonly name: string;
  readonly employmentType: EmploymentType;
  readonly pensumPercent: number | null;
  /** Minutes the person is already planned this week (e.g. at the other site). */
  readonly plannedMinutes: number;
  /** Usual shift times; used instead of the service window when set. */
  readonly usualFromMin?: number | null;
  readonly usualToMin?: number | null;
}

export interface SuggestedShift {
  userId: string;
  date: string;
  startMin: number;
  endMin: number;
  service: Service;
}

export interface SuggestGap {
  date: string;
  service: Service;
  missing: number;
}

const WINDOWS = { LUNCH: LUNCH_WINDOW, DINNER: DINNER_WINDOW } as const;
/** A shift must be at least this long. */
const MIN_SHIFT = 180;
/** A shift counts for the other service of the day when it overlaps it this much. */
const COVER_MIN = 90;

const overlap = (aFrom: number, aTo: number, bFrom: number, bTo: number) => Math.min(aTo, bTo) - Math.max(aFrom, bFrom);
const target = (p: SuggestPerson) => (p.pensumPercent && (p.employmentType === 'FULL_TIME' || p.employmentType === 'PART_TIME') ? weeklyMinutes(p.pensumPercent) : null);

/** The times a person would work for a service, or null if they cannot (too short, not offered). */
export function shiftSpan(person: SuggestPerson, offer: AvailabilityDay | undefined, service: Service): { start: number; end: number } | null {
  if (!offer || !offerCovers(offer, WINDOWS[service])) return null;
  const win = WINDOWS[service];
  const usual = person.usualFromMin != null && person.usualToMin != null;
  let start = usual ? person.usualFromMin! : win.fromMin;
  let end = usual ? person.usualToMin! : win.toMin;
  if (offer.fromMin !== null && offer.toMin !== null) {
    start = Math.max(start, offer.fromMin);
    end = Math.min(end, offer.toMin);
  }
  // a usual block (e.g. 12:00–21:00) may only touch a service; a plain service shift must be long enough
  if (end - start < MIN_SHIFT || overlap(start, end, win.fromMin, win.toMin) < (usual ? COVER_MIN : MIN_SHIFT)) return null;
  return { start, end };
}

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
  const shifts: SuggestedShift[] = [];
  const gaps: SuggestGap[] = [];
  const workingToday = new Map<string, Set<string>>();
  const coveredDinner = new Map<string, Set<string>>(); // people whose lunch shift already covers dinner

  weekDates(input.weekStart).forEach((date, i) => {
    const need = input.needs[i] ?? { lunchPeople: 0, dinnerPeople: 0 };
    const today = workingToday.get(date) ?? new Set<string>();
    workingToday.set(date, today);
    for (const service of ['LUNCH', 'DINNER'] as const) {
      const wanted = service === 'LUNCH' ? need.lunchPeople : need.dinnerPeople;
      const chosen = new Set<string>(service === 'DINNER' ? (coveredDinner.get(date) ?? []) : []);
      if (wanted <= 0) continue;
      for (const pass of ['contract', 'any'] as const) {
        while (chosen.size < wanted) {
          const candidates = input.people
            .map((p) => {
              if (chosen.has(p.userId) || input.away(p.userId, date)) return null;
              const span = shiftSpan(p, input.offers.find((o) => o.userId === p.userId && o.date === date), service);
              if (!span) return null;
              const t = target(p);
              const left = t === null ? -1 : t - (minutes.get(p.userId) ?? 0);
              if (pass === 'contract' && (t === null || left < span.end - span.start - 30)) return null;
              return { p, span, left, hasToday: today.has(p.userId) };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null)
            // already working today first (one block of the day), then the most hours still owed; casual staff last
            .sort((a, b) => Number(b.hasToday) - Number(a.hasToday) || b.left - a.left || a.p.name.localeCompare(b.p.name));
          const pick = candidates[0];
          if (!pick) break;
          chosen.add(pick.p.userId);
          today.add(pick.p.userId);
          minutes.set(pick.p.userId, (minutes.get(pick.p.userId) ?? 0) + (pick.span.end - pick.span.start));
          shifts.push({ userId: pick.p.userId, date, startMin: pick.span.start, endMin: pick.span.end, service });
          // a long block (e.g. 12:00–20:00) also covers the dinner need
          if (service === 'LUNCH' && overlap(pick.span.start, pick.span.end, DINNER_WINDOW.fromMin, DINNER_WINDOW.toMin) >= COVER_MIN) {
            const set = coveredDinner.get(date) ?? new Set<string>();
            set.add(pick.p.userId);
            coveredDinner.set(date, set);
          }
        }
        if (chosen.size >= wanted) break;
      }
      if (chosen.size < wanted) gaps.push({ date, service, missing: wanted - chosen.size });
    }
  });
  return { shifts, gaps };
}

export interface GapCandidate {
  userId: string;
  name: string;
  startMin: number;
  endMin: number;
  /** Contract minutes still open this week; null for casual staff. */
  leftMinutes: number | null;
  /** Already works that day, so this would be a second block. */
  worksThatDay: boolean;
}

export interface GapInfo extends SuggestGap {
  candidates: GapCandidate[];
}

/** Which Lunch/Dinner services of a planned week are short, and who could fill each one. */
export function findGaps(input: {
  weekStart: string;
  people: readonly SuggestPerson[];
  needs: readonly DayNeed[];
  offers: readonly AvailabilityDay[];
  away: (userId: string, date: string) => boolean;
  planned: readonly { userId: string | null; date: string; startMin: number; endMin: number; breakMin?: number }[];
}): GapInfo[] {
  const out: GapInfo[] = [];
  weekDates(input.weekStart).forEach((date, i) => {
    const need = input.needs[i] ?? { lunchPeople: 0, dinnerPeople: 0 };
    const day = input.planned.filter((s) => s.userId && s.date === date);
    for (const service of ['LUNCH', 'DINNER'] as const) {
      const win = WINDOWS[service];
      const wanted = service === 'LUNCH' ? need.lunchPeople : need.dinnerPeople;
      const covering = new Set(day.filter((s) => s.startMin < win.toMin && s.endMin > win.fromMin).map((s) => s.userId!));
      const missing = wanted - covering.size;
      if (missing <= 0) continue;
      const candidates: GapCandidate[] = [];
      for (const p of input.people) {
        if (covering.has(p.userId) || input.away(p.userId, date)) continue;
        const span = shiftSpan(p, input.offers.find((o) => o.userId === p.userId && o.date === date), service);
        if (!span) continue;
        // not on top of one of their own shifts that day
        if (day.some((s) => s.userId === p.userId && s.startMin < span.end && s.endMin > span.start)) continue;
        const t = target(p);
        const done = p.plannedMinutes + input.planned.filter((s) => s.userId === p.userId).reduce((n, s) => n + shiftNetMinutes({ startMin: s.startMin, endMin: s.endMin, breakMin: s.breakMin ?? 0 }), 0);
        candidates.push({ userId: p.userId, name: p.name, startMin: span.start, endMin: span.end, leftMinutes: t === null ? null : t - done, worksThatDay: day.some((s) => s.userId === p.userId) });
      }
      candidates.sort((a, b) => Number(b.worksThatDay) - Number(a.worksThatDay) || (b.leftMinutes ?? -1) - (a.leftMinutes ?? -1) || a.name.localeCompare(b.name));
      out.push({ date, service, missing, candidates });
    }
  });
  return out;
}
