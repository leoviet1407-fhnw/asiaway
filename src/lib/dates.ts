export const TIMEZONE = 'Europe/Zurich';

/** "2026-11-14" → "Sa, 14.11.2026". Dates without time are read as calendar days. */
export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate) return '–';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat('de-CH', { weekday: 'short', timeZone: 'UTC' }).format(date);
  return `${weekday.replace('.', '')}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

/** A timestamp in Zurich time: "12.11.2026, 14:05". */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '–';
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE,
  }).format(date);
}

/** Today's calendar date in Zurich as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now);
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}
