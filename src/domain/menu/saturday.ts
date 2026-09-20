/**
 * Which day it is, in the restaurant's own time.
 *
 * "Saturday" has to mean Saturday in Zurich, not in UTC and not on the guest's
 * phone. A guest whose phone is set to Bangkok is still sitting in the
 * restaurant, and between 23:00 and midnight Zurich time UTC has already moved
 * on to Sunday — either mistake would show the wrong menu to someone holding a
 * printed one.
 */
export const RESTAURANT_TIME_ZONE = 'Europe/Zurich';

/** ISO-8601 weekday numbers, so Monday is 1 and Sunday is 7. */
export const SATURDAY = 6;

/**
 * The restaurant's local date, as YYYY-MM-DD.
 *
 * Built from the formatted parts rather than by shifting the clock, so it stays
 * correct across the two days a year when Swiss clocks change.
 */
export function restaurantDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RESTAURANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The ISO weekday (Monday 1 … Sunday 7) in the restaurant's time zone. */
export function restaurantWeekday(now: Date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-GB', {
    timeZone: RESTAURANT_TIME_ZONE,
    weekday: 'short',
  }).format(now);

  const days: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return days[name] ?? 0;
}

export function isSaturday(now: Date = new Date()): boolean {
  return restaurantWeekday(now) === SATURDAY;
}

/** The ISO weekday of a plain YYYY-MM-DD date, with no time zone involved. */
export function weekdayOfDate(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return 0;
  // Fixed to midday UTC so no time-zone offset can push it onto another day.
  const day = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isSaturdayDate(isoDate: string): boolean {
  return weekdayOfDate(isoDate) === SATURDAY;
}

/**
 * Whether a dish is sold today.
 *
 * An empty or missing list means every day. Almost the whole menu is on every
 * day, so that has to be the case that needs no data.
 */
export function isAvailableOnWeekday(
  availableWeekdays: readonly number[] | null | undefined,
  weekday: number,
): boolean {
  if (!availableWeekdays || availableWeekdays.length === 0) return true;
  return availableWeekdays.includes(weekday);
}

/**
 * The next Saturday on or after a given date, as YYYY-MM-DD.
 *
 * What the upload screen offers by default: on a Saturday it is today, and any
 * other day it is the Saturday being prepared for.
 */
export function nextSaturday(from: string = restaurantDate()): string {
  const [y, m, d] = from.split('-').map(Number);
  if (!y || !m || !d) return from;

  const base = new Date(Date.UTC(y, m - 1, d, 12));
  const weekday = weekdayOfDate(from);
  const ahead = (SATURDAY - weekday + 7) % 7;
  base.setUTCDate(base.getUTCDate() + ahead);

  return base.toISOString().slice(0, 10);
}
