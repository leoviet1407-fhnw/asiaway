/**
 * Wall-clock times in the restaurant's zone, converted to real instants.
 *
 * A roster is written in wall clock — "17:30 to 22:00" — but a shift has to be
 * stored as an instant, and Switzerland changes its clocks in late October,
 * inside a roster period. Storing the wall clock as though it were UTC would
 * make the arithmetic look right and quietly put every shift after the change
 * an hour out from the moment it actually happens, which B3's time recording
 * would then inherit.
 *
 * Intl is used rather than a timezone library: Node ships full ICU, and the
 * zone data is the same data a library would bundle.
 */

/** Offset in minutes that `timeZone` is ahead of UTC at a given instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // 24 is how en-US with hour12:false renders midnight; Date.UTC handles it,
  // but normalising keeps the arithmetic obvious.
  const hour = get('hour') % 24;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant at which a wall-clock time occurs in `timeZone`.
 *
 * Two passes: guess the offset from the naive reading, then re-read it at that
 * corrected instant. That second pass is what gets the hours either side of a
 * clock change right.
 *
 * On the spring-forward night 02:30 does not exist and on the autumn night it
 * happens twice. Both resolve to a real instant here rather than throwing —
 * the restaurant is closed at 02:30, and a roster that refuses to save is
 * worse than one that picks the earlier of two identical-looking minutes.
 */
export function zonedInstant(isoDate: string, wallClock: string, timeZone: string): Date {
  const [hours, minutes] = wallClock.split(':').map(Number);
  const naive = Date.parse(`${isoDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`);

  let instant = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  instant = new Date(naive - offsetMinutes(instant, timeZone) * 60_000);
  return instant;
}

/** Minutes since local midnight, in `timeZone`. */
export function localMinutesIn(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (get('hour') % 24) * 60 + get('minute');
}

/** The local calendar date, in `timeZone`. A shift ending at 00:30 belongs to the day it started. */
export function localDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export const RESTAURANT_TIME_ZONE =
  process.env.NEXT_PUBLIC_RESTAURANT_TIMEZONE?.trim() || 'Europe/Zurich';
