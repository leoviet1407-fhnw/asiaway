import type { Lang } from '@/i18n/translate';

export const TIMEZONE = 'Europe/Zurich';

const WEEKDAYS: Record<Lang, string[]> = {
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/** "2026-11-14" → "Sa, 14.11.2026" (or "Sat, 14.11.2026"). Dates without time are read as calendar days. */
export function formatDay(isoDate: string | null | undefined, lang: Lang = 'de'): string {
  if (!isoDate) return '–';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const weekday = WEEKDAYS[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${weekday}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

/** "2026-11" → "November 2026" in the language. */
export function monthLabel(month: string, lang: Lang = 'de'): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
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
