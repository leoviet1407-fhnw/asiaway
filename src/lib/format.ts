import { NUMBER_LOCALE } from '../i18n/locales';

export const RESTAURANT_TIMEZONE = process.env.NEXT_PUBLIC_RESTAURANT_TIMEZONE ?? 'Europe/Zurich';

/** Money is stored in Rappen; this is the only place it becomes text. */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    style: 'currency',
    currency: 'CHF',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Timestamps are authoritative UTC from the server and are rendered in the
 * restaurant's local time — never the customer device's clock.
 */
export function formatTime(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(NUMBER_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: RESTAURANT_TIMEZONE,
  }).format(date);
}

export function formatDateTime(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(NUMBER_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: RESTAURANT_TIMEZONE,
  }).format(date);
}

/** How long a table has been sitting: "12 min", "1 h 04". */
export function formatElapsed(iso: string | Date): string {
  const then = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}
