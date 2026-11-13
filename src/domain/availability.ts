/**
 * Hours offered versus the contract, and the staffing the restaurant needs.
 * Pure functions, no database.
 *
 * Staff choose the days and times they can work. Per week the hours offered
 * must reach the contract: weekly hours = 42 h × pensum (100 % = 42 h). A whole
 * offered day counts as a standard day of 8.4 h (42 h / 5 days), a time window
 * counts its own length. Holiday and sick weekdays count as a standard day.
 */
import { WEEKLY_HOURS_AT_100, weeklyMinutes } from './hours';
import { addDays, weekDates, type Absence, type AvailabilityDay } from './roster';

/** One standard working day: 42 h / 5 = 8.4 h. */
export const STANDARD_DAY_MINUTES = (WEEKLY_HOURS_AT_100 * 60) / 5;

/** The two services of a restaurant day: Lunch 10:30–14:30, Dinner 17:30–22:00. */
export const LUNCH_WINDOW = { fromMin: 10 * 60 + 30, toMin: 14 * 60 + 30 } as const;
export const DINNER_WINDOW = { fromMin: 17 * 60 + 30, toMin: 22 * 60 } as const;
export const LUNCH_HOURS = (LUNCH_WINDOW.toMin - LUNCH_WINDOW.fromMin) / 60;
export const DINNER_HOURS = (DINNER_WINDOW.toMin - DINNER_WINDOW.fromMin) / 60;

type Offer = Pick<AvailabilityDay, 'kind' | 'fromMin' | 'toMin'>;

/** Minutes one day's entry offers: 0 unless AVAILABLE; a whole day is a standard day. */
export function offeredMinutes(offer: Offer | undefined | null): number {
  if (!offer || offer.kind !== 'AVAILABLE') return 0;
  if (offer.fromMin === null || offer.toMin === null) return STANDARD_DAY_MINUTES;
  return Math.max(0, Math.min(offer.toMin - offer.fromMin, 14 * 60));
}

/** Whether the day's offer covers some of the service window (a whole day covers both). */
export function offerCovers(offer: Offer | undefined | null, window: { fromMin: number; toMin: number }): boolean {
  if (!offer || offer.kind !== 'AVAILABLE') return false;
  if (offer.fromMin === null || offer.toMin === null) return true;
  return offer.fromMin < window.toMin && offer.toMin > window.fromMin;
}

const isWeekday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
};

export interface WeekStatus {
  readonly weekStart: string;
  readonly offeredMinutes: number;
  /** Vacation and sick weekdays, counted as standard days. */
  readonly creditMinutes: number;
  /** null for people without a pensum (Aushilfe, management). */
  readonly requiredMinutes: number | null;
  readonly ok: boolean;
  readonly missingMinutes: number;
}

/** One week of one person: what they offered, what is credited, what the contract needs. */
export function weekStatus(input: {
  weekStart: string;
  pensumPercent: number | null;
  availability: readonly AvailabilityDay[];
  /** Approved or requested absences (holiday, sick) of this person. */
  absences: readonly Pick<Absence, 'startDate' | 'endDate' | 'type'>[];
}): WeekStatus {
  const dates = weekDates(input.weekStart);
  const absent = (date: string) => input.absences.some((a) => (a.type === 'VACATION' || a.type === 'SICK') && a.startDate <= date && date <= a.endDate);
  let offered = 0;
  let credit = 0;
  for (const date of dates) {
    if (absent(date)) {
      if (isWeekday(date)) credit += STANDARD_DAY_MINUTES;
      continue;
    }
    offered += offeredMinutes(input.availability.find((a) => a.date === date));
  }
  const required = input.pensumPercent === null ? null : weeklyMinutes(input.pensumPercent);
  const missing = required === null ? 0 : Math.max(0, required - offered - credit);
  return { weekStart: input.weekStart, offeredMinutes: offered, creditMinutes: credit, requiredMinutes: required, ok: missing === 0, missingMinutes: missing };
}

/** The Monday of the week containing a date. */
export function mondayOfDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** The weeks that belong to a month: every week whose Monday lies in it (each week appears in exactly one month). */
export function weeksOfMonth(month: string): string[] {
  const weeks: string[] = [];
  for (let m = mondayOfDate(`${month}-01`); m.slice(0, 7) <= month; m = addDays(m, 7)) {
    if (m.slice(0, 7) === month) weeks.push(m);
  }
  return weeks;
}

/** Weeks of the month that staff can still change completely (all seven days open). */
export function weeksToCheck(month: string, firstOpenDate: string): string[] {
  return weeksOfMonth(month).filter((monday) => monday >= firstOpenDate);
}

// --- Staffing need ---------------------------------------------------------------------------
export interface DayNeed {
  readonly lunchPeople: number;
  readonly dinnerPeople: number;
}

export interface CoverageDay {
  readonly date: string;
  readonly need: DayNeed;
  /** People who offered a time that covers the service. */
  readonly offeredLunch: number;
  readonly offeredDinner: number;
  /** People planned (shifts) in the service. */
  readonly plannedLunch: number;
  readonly plannedDinner: number;
}

export type CoverageState = 'ok' | 'tight' | 'gap' | 'none';

/** Is the need met? "tight" = just enough offered; "gap" = fewer offered than needed. */
export function coverageState(need: number, have: number): CoverageState {
  if (need <= 0) return 'none';
  if (have < need) return 'gap';
  return have === need ? 'tight' : 'ok';
}

/** The hours a week needs: need × service hours, summed over the days. */
export function needHours(needs: readonly DayNeed[]): number {
  return needs.reduce((sum, n) => sum + n.lunchPeople * LUNCH_HOURS + n.dinnerPeople * DINNER_HOURS, 0);
}

/**
 * The need per weekday that a planned week implies: how many different people
 * work at Lunch / at Dinner on each weekday (Mon = 1 … Sun = 7).
 */
export function needsFromShifts(
  shiftList: readonly { date: string; userId: string | null; startMin: number; endMin: number }[],
  weekStart: string,
): DayNeed[] {
  return weekDates(weekStart).map((date) => {
    const day = shiftList.filter((s) => s.date === date && s.userId);
    const covers = (w: { fromMin: number; toMin: number }) => new Set(day.filter((s) => s.startMin < w.toMin && s.endMin > w.fromMin).map((s) => s.userId)).size;
    return { lunchPeople: covers(LUNCH_WINDOW), dinnerPeople: covers(DINNER_WINDOW) };
  });
}
