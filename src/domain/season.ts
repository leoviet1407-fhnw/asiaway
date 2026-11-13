/**
 * Holiday season: public holidays, special days with their own staffing need, and
 * limits on how many people may be on holiday at the same time. Pure functions.
 */
import type { DayNeed } from './availability';
import { addDays } from './roster';

export interface Holiday {
  date: string;
  label: string;
}

/** Easter Sunday (Gauss). */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Public holidays in the canton of Zürich, plus the days restaurants usually treat specially. */
export function swissHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const y = (md: string) => `${year}-${md}`;
  return [
    { date: y('01-01'), label: 'Neujahr' },
    { date: y('01-02'), label: 'Berchtoldstag' },
    { date: addDays(easter, -2), label: 'Karfreitag' },
    { date: addDays(easter, 1), label: 'Ostermontag' },
    { date: y('05-01'), label: 'Tag der Arbeit' },
    { date: addDays(easter, 39), label: 'Auffahrt' },
    { date: addDays(easter, 50), label: 'Pfingstmontag' },
    { date: y('08-01'), label: 'Bundesfeier' },
    { date: y('12-24'), label: 'Heiligabend' },
    { date: y('12-25'), label: 'Weihnachten' },
    { date: y('12-26'), label: 'Stephanstag' },
    { date: y('12-31'), label: 'Silvester' },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 800; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface SpecialDay {
  readonly date: string;
  readonly label: string;
  readonly closed: boolean;
  readonly lunchPeople: number;
  readonly dinnerPeople: number;
}

/** The staffing need of a date: a special day overrides the weekday need. */
export function needFor(weekdayNeed: DayNeed, special: SpecialDay | undefined | null): DayNeed {
  if (!special) return weekdayNeed;
  return special.closed ? { lunchPeople: 0, dinnerPeople: 0 } : { lunchPeople: special.lunchPeople, dinnerPeople: special.dinnerPeople };
}

export interface VacationRule {
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly maxPeople: number;
}

export interface VacationConflict {
  date: string;
  label: string;
  /** People already away that day (not counting the requester). */
  count: number;
  max: number;
}

/**
 * The first day of a holiday request on which a rule would be exceeded, or null.
 * `others` = holidays (requested or approved) of other people of the same site.
 */
export function vacationConflict(input: {
  rules: readonly VacationRule[];
  others: readonly { userId: string; startDate: string; endDate: string }[];
  userId: string;
  startDate: string;
  endDate: string;
}): VacationConflict | null {
  for (const date of eachDate(input.startDate, input.endDate)) {
    const rule = input.rules.filter((r) => r.startDate <= date && date <= r.endDate).sort((a, b) => a.maxPeople - b.maxPeople)[0];
    if (!rule) continue;
    const away = new Set(input.others.filter((o) => o.userId !== input.userId && o.startDate <= date && date <= o.endDate).map((o) => o.userId)).size;
    if (away + 1 > rule.maxPeople) return { date, label: rule.label, count: away, max: rule.maxPeople };
  }
  return null;
}
