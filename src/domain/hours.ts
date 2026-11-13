/**
 * Vacation balance and overtime. Pure functions, no database.
 *
 * Decisions (confirmed): vacation is counted in WEEKDAYS (Mon–Fri), 25 a year by
 * default, which is five weeks whatever the pensum. A 100 % contract is 42.5 hours
 * a week; the monthly target is the weekly hours times the days of the month / 7.
 * Vacation and sick weekdays count as worked at the average daily contract hours.
 * Only people with a pensum have a target and so an overtime balance.
 */
import { addDays, monthDates, type AbsenceType } from './roster';

export const DEFAULT_VACATION_DAYS = 25;
export const WEEKLY_HOURS_AT_100 = 42.5;

// --- Vacation ------------------------------------------------------------------------------
const isWeekday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
};

/** Weekdays of [start, end] that fall inside [from, to] (all inclusive, YYYY-MM-DD). */
export function countWeekdays(start: string, end: string, from: string, to: string): number {
  const a = start > from ? start : from;
  const b = end < to ? end : to;
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWeekday(d)) n += 1;
  return n;
}

export interface VacationRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  readonly type: AbsenceType;
}

export interface VacationBalance {
  readonly year: number;
  readonly entitlement: number;
  readonly carry: number;
  /** Approved vacation weekdays in the year. */
  readonly taken: number;
  /** Requested but not yet approved. */
  readonly requested: number;
  /** entitlement + carry − taken − requested */
  readonly remaining: number;
  /** After approving only what is already approved. */
  readonly remainingApproved: number;
}

export function vacationBalance(year: number, entitlement: number, carry: number, ranges: readonly VacationRange[]): VacationBalance {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const count = (status: 'APPROVED' | 'REQUESTED') =>
    ranges.filter((r) => r.type === 'VACATION' && r.status === status).reduce((sum, r) => sum + countWeekdays(r.startDate, r.endDate, from, to), 0);
  const taken = count('APPROVED');
  const requested = count('REQUESTED');
  const total = entitlement + carry;
  return { year, entitlement, carry, taken, requested, remaining: total - taken - requested, remainingApproved: total - taken };
}

/** From 1 October on, a large unused balance is worth a reminder. */
export function vacationNeedsAttention(balance: VacationBalance, today: string): boolean {
  return today >= `${balance.year}-10-01` && today <= `${balance.year}-12-31` && balance.remaining >= 5;
}

// --- Hours and overtime ------------------------------------------------------------------------
export function weeklyMinutes(pensumPercent: number): number {
  return Math.round((WEEKLY_HOURS_AT_100 * 60 * pensumPercent) / 100);
}

/** What one working weekday counts for on vacation or sick leave. */
export function dailyCreditMinutes(pensumPercent: number): number {
  return Math.round(weeklyMinutes(pensumPercent) / 5);
}

export function monthTargetMinutes(pensumPercent: number, month: string): number {
  return Math.round((weeklyMinutes(pensumPercent) * monthDates(month).length) / 7);
}

export interface MonthTotalsInput {
  readonly month: string;
  /** null for Aushilfen and the management: hours are shown, no target. */
  readonly pensumPercent: number | null;
  /** Net worked minutes (end − start − break) of the confirmed entries. */
  readonly workedMinutes: number;
  /** Absences of the month with their type. */
  readonly absences: readonly { startDate: string; endDate: string; type: AbsenceType }[];
}

export interface MonthTotals {
  readonly workedMinutes: number;
  /** Vacation and sick weekdays credited as worked. */
  readonly creditMinutes: number;
  readonly creditDays: number;
  readonly targetMinutes: number | null;
  /** worked + credit − target; null without a target. */
  readonly overtimeMinutes: number | null;
}

export function monthTotals(input: MonthTotalsInput): MonthTotals {
  const dates = monthDates(input.month);
  const first = dates[0]!;
  const last = dates.at(-1)!;
  if (input.pensumPercent === null) {
    return { workedMinutes: input.workedMinutes, creditMinutes: 0, creditDays: 0, targetMinutes: null, overtimeMinutes: null };
  }
  const creditDays = input.absences
    .filter((a) => a.type === 'VACATION' || a.type === 'SICK')
    .reduce((sum, a) => sum + countWeekdays(a.startDate, a.endDate, first, last), 0);
  const creditMinutes = creditDays * dailyCreditMinutes(input.pensumPercent);
  const targetMinutes = monthTargetMinutes(input.pensumPercent, input.month);
  return { workedMinutes: input.workedMinutes, creditMinutes, creditDays, targetMinutes, overtimeMinutes: input.workedMinutes + creditMinutes - targetMinutes };
}

/** "+3 h 30 min" / "−1 h 15 min" / "±0". */
export function formatOvertime(minutes: number): string {
  if (minutes === 0) return '±0';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h} h${m ? ` ${m} min` : ''}`;
}

export function formatWorked(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}
