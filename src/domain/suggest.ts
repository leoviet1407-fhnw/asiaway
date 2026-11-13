/**
 * "Plan vorschlagen" and "Wer kann diese Lücke füllen?". Pure functions, no database.
 *
 * A draft fills Lunch and Dinner per day from the staffing need: people furthest below their
 * contract come first, people who already work that day take the second service too, and a
 * person's usual times (e.g. Yen 17:00–21:30) are used as they are. The opening hours of the site
 * decide the times: staff arrive 30–60 min before opening (first person 60, the others 30), a
 * closed day gets nobody, and on a day that is open all day (Saturday in Oerlikon) staff stay the
 * whole day as far as their remaining hours allow. The Leitung then corrects the draft.
 */
import { LUNCH_WINDOW, DINNER_WINDOW, offerCovers, type DayNeed } from './availability';
import { weeklyMinutes } from './hours';
import { requiredBreakMin, shiftNetMinutes, weekDates, weekdayNo, type AvailabilityDay, type DayHours, type EmploymentType, type ServiceWindow } from './roster';

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
  /** Sundays the person already works this month (not counting this week): everybody works at least one. */
  readonly sundays?: number;
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

/** Hours used when a site gives none: the standard Lunch and Dinner windows, nobody early. */
const DEFAULT_DAY: DayHours = { closed: false, lunch: LUNCH_WINDOW, dinner: DINNER_WINDOW, wholeDay: false, leadFirst: 0, leadOther: 0 };
/** A shift must be at least this long. */
const MIN_SHIFT = 180;
/** A shift counts for the other service of the day when it overlaps it this much. */
const COVER_MIN = 90;

const overlap = (aFrom: number, aTo: number, bFrom: number, bTo: number) => Math.min(aTo, bTo) - Math.max(aFrom, bFrom);
const target = (p: SuggestPerson) => (p.pensumPercent && (p.employmentType === 'FULL_TIME' || p.employmentType === 'PART_TIME') ? weeklyMinutes(p.pensumPercent) : null);
const net = (start: number, end: number) => end - start - requiredBreakMin(start, end);

/** The times a person would work for a service, or null if they cannot (too short, not offered). */
export function shiftSpan(person: SuggestPerson, offer: AvailabilityDay | undefined, service: Service, win: ServiceWindow = service === 'LUNCH' ? LUNCH_WINDOW : DINNER_WINDOW, lead = 0): { start: number; end: number } | null {
  if (!offer || !offerCovers(offer, win)) return null;
  const usual = person.usualFromMin != null && person.usualToMin != null;
  let start = usual ? person.usualFromMin! : win.fromMin - lead;
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
  /** Shifts people already have elsewhere (the other site): nobody is planned twice at the same time. */
  busy?: readonly { userId: string | null; date: string; startMin: number; endMin: number }[];
  /** What is already planned at this site this week: it counts towards the need and is kept as it is. */
  existing?: readonly { userId: string | null; date: string; startMin: number; endMin: number; breakMin?: number }[];
  /** Opening hours of the site per date; default: the standard service times. */
  dayHours?: (date: string) => DayHours;
}): { shifts: SuggestedShift[]; gaps: SuggestGap[] } {
  const clash = (userId: string, date: string, start: number, end: number) => [...(input.busy ?? []), ...(input.existing ?? [])].some((b) => b.userId === userId && b.date === date && b.startMin < end && b.endMin > start);
  const minutes = new Map(input.people.map((p) => [p.userId, p.plannedMinutes + (input.existing ?? []).filter((e) => e.userId === p.userId).reduce((n, e) => n + shiftNetMinutes({ startMin: e.startMin, endMin: e.endMin, breakMin: e.breakMin ?? 0 }), 0)]));
  const shifts: SuggestedShift[] = [];
  const gaps: SuggestGap[] = [];
  const sundayCount = new Map(input.people.map((p) => [p.userId, p.sundays ?? 0]));
  for (const e of (input.existing ?? []).filter((x) => x.userId && weekdayNo(x.date) === 7)) sundayCount.set(e.userId!, (sundayCount.get(e.userId!) ?? 0) + 1);
  const workingToday = new Map<string, Set<string>>();
  const coveredDinner = new Map<string, Set<string>>(); // people whose lunch shift already covers dinner

  weekDates(input.weekStart).forEach((date, i) => {
    const dh = input.dayHours?.(date) ?? DEFAULT_DAY;
    if (dh.closed) return; // closed: nobody is planned and nothing is missing
    const need = input.needs[i] ?? { lunchPeople: 0, dinnerPeople: 0 };
    const today = workingToday.get(date) ?? new Set<string>();
    for (const e of (input.existing ?? []).filter((x) => x.date === date && x.userId)) today.add(e.userId!);
    workingToday.set(date, today);
    for (const service of ['LUNCH', 'DINNER'] as const) {
      const wanted = service === 'LUNCH' ? need.lunchPeople : need.dinnerPeople;
      const win = service === 'LUNCH' ? dh.lunch : dh.dinner;
      // people already planned for this service (kept as they are) count towards the need
      const chosen = new Set<string>([...(service === 'DINNER' ? (coveredDinner.get(date) ?? []) : []), ...(input.existing ?? []).filter((e) => e.userId && e.date === date && e.startMin < win.toMin && e.endMin > win.fromMin).map((e) => e.userId!)]);
      if (wanted <= 0) continue;
      for (const pass of ['contract', 'any'] as const) {
        while (chosen.size < wanted) {
          const candidates = input.people
            .map((p) => {
              if (chosen.has(p.userId) || input.away(p.userId, date)) return null;
              const span = shiftSpan(p, input.offers.find((o) => o.userId === p.userId && o.date === date), service, win, dh.leadOther);
              if (!span || clash(p.userId, date, span.start, span.end)) return null;
              const t = target(p);
              const left = t === null ? -1 : t - (minutes.get(p.userId) ?? 0);
              if (pass === 'contract' && (t === null || left < net(span.start, span.end) - 30)) return null;
              return { p, span, left, hasToday: today.has(p.userId) };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null)
            // on a Sunday the people with the fewest Sundays this month come first (everybody works at least one);
            // then already working today (one block of the day), then the most hours still owed; casual staff last
            .sort((a, b) => (weekdayNo(date) === 7 ? (sundayCount.get(a.p.userId) ?? 0) - (sundayCount.get(b.p.userId) ?? 0) : 0) || Number(b.hasToday) - Number(a.hasToday) || b.left - a.left || a.p.name.localeCompare(b.p.name));
          const pick = candidates[0];
          if (!pick) break;
          const offer = input.offers.find((o) => o.userId === pick.p.userId && o.date === date);
          // the first person arrives earliest (e.g. 60 min before opening), the others a bit later
          let span = shiftSpan(pick.p, offer, service, win, chosen.size === 0 ? dh.leadFirst : dh.leadOther) ?? pick.span;
          // a day that is open all day: staff with hours left stay the whole day, as far as their hours allow
          const t = target(pick.p);
          if (service === 'LUNCH' && dh.wholeDay && t !== null && !(pick.p.usualFromMin != null && pick.p.usualToMin != null)) {
            const limit = offer && offer.fromMin !== null && offer.toMin !== null ? Math.min(dh.dinner.toMin, offer.toMin) : dh.dinner.toMin;
            let end = limit;
            const remaining = Math.max(0, t - (minutes.get(pick.p.userId) ?? 0));
            // shorten from the end until the net hours fit what is left (never below the lunch service itself)
            while (end > span.end && net(span.start, end) > remaining) end -= 15;
            if (end > span.end) span = { start: span.start, end };
          }
          if (weekdayNo(date) === 7 && !today.has(pick.p.userId)) sundayCount.set(pick.p.userId, (sundayCount.get(pick.p.userId) ?? 0) + 1);
          chosen.add(pick.p.userId);
          today.add(pick.p.userId);
          minutes.set(pick.p.userId, (minutes.get(pick.p.userId) ?? 0) + net(span.start, span.end));
          shifts.push({ userId: pick.p.userId, date, startMin: span.start, endMin: span.end, service });
          // a long block (e.g. 12:00–20:00, or the whole day) also covers the dinner need
          if (service === 'LUNCH' && overlap(span.start, span.end, dh.dinner.fromMin, dh.dinner.toMin) >= COVER_MIN) {
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
  busy?: readonly { userId: string | null; date: string; startMin: number; endMin: number }[];
  dayHours?: (date: string) => DayHours;
}): GapInfo[] {
  const out: GapInfo[] = [];
  const people = input.people;
  weekDates(input.weekStart).forEach((date, i) => {
    const dh = input.dayHours?.(date) ?? DEFAULT_DAY;
    if (dh.closed) return;
    const need = input.needs[i] ?? { lunchPeople: 0, dinnerPeople: 0 };
    const day = input.planned.filter((s) => s.userId && s.date === date);
    for (const service of ['LUNCH', 'DINNER'] as const) {
      const win = service === 'LUNCH' ? dh.lunch : dh.dinner;
      const wanted = service === 'LUNCH' ? need.lunchPeople : need.dinnerPeople;
      const covering = new Set(day.filter((s) => s.startMin < win.toMin && s.endMin > win.fromMin).map((s) => s.userId!));
      const missing = wanted - covering.size;
      if (missing <= 0) continue;
      const candidates: GapCandidate[] = [];
      for (const p of input.people) {
        if (covering.has(p.userId) || input.away(p.userId, date)) continue;
        const span = shiftSpan(p, input.offers.find((o) => o.userId === p.userId && o.date === date), service, win, dh.leadOther);
        if (!span || (input.busy ?? []).some((b) => b.userId === p.userId && b.date === date && b.startMin < span.end && b.endMin > span.start)) continue;
        // not on top of one of their own shifts that day
        if (day.some((s) => s.userId === p.userId && s.startMin < span.end && s.endMin > span.start)) continue;
        const t = target(p);
        const done = p.plannedMinutes + input.planned.filter((s) => s.userId === p.userId).reduce((n, s) => n + shiftNetMinutes({ startMin: s.startMin, endMin: s.endMin, breakMin: s.breakMin ?? 0 }), 0);
        candidates.push({ userId: p.userId, name: p.name, startMin: span.start, endMin: span.end, leftMinutes: t === null ? null : t - done, worksThatDay: day.some((s) => s.userId === p.userId) });
      }
      candidates.sort((a, b) => (weekdayNo(date) === 7 ? (people.find((x) => x.userId === a.userId)?.sundays ?? 0) - (people.find((x) => x.userId === b.userId)?.sundays ?? 0) : 0) || Number(b.worksThatDay) - Number(a.worksThatDay) || (b.leftMinutes ?? -1) - (a.leftMinutes ?? -1) || a.name.localeCompare(b.name));
      out.push({ date, service, missing, candidates });
    }
  });
  return out;
}
