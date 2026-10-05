/**
 * Has a contracted employee offered enough of the month?
 *
 * A 100% employee owes the corridor's minimum hours, so the days they offer must
 * be able to add up to it. A long window does not count for more than a normal
 * working day: offering 10:30-22:00 every day is one shift's worth of work per
 * day, not eleven and a half hours.
 *
 * PROVISIONAL: the per-day cap is a planning figure, not a legal limit.
 */
export const MAX_COUNTED_MINUTES_PER_DAY = 510; // 8 h 30

export interface OfferedWindow {
  readonly onDate: string;
  readonly kind: 'AVAILABLE' | 'PREFERRED' | 'UNAVAILABLE';
  readonly fromTime: string; // HH:MM
  readonly toTime: string;
}

export interface Coverage {
  readonly offeredDays: number;
  readonly offeredMinutes: number;
  readonly requiredMinutes: number;
  readonly requiredDays: number;
  readonly missingDays: number;
  readonly complete: boolean;
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function coverage(
  windows: readonly OfferedWindow[],
  requiredMinutes: number,
): Coverage {
  const perDay = new Map<string, number>();
  for (const w of windows) {
    if (w.kind === 'UNAVAILABLE') continue;
    const len = Math.max(0, toMinutes(w.toTime) - toMinutes(w.fromTime));
    perDay.set(w.onDate, (perDay.get(w.onDate) ?? 0) + len);
  }
  let offeredMinutes = 0;
  for (const m of perDay.values()) offeredMinutes += Math.min(m, MAX_COUNTED_MINUTES_PER_DAY);

  const requiredDays = Math.ceil(requiredMinutes / MAX_COUNTED_MINUTES_PER_DAY);
  const offeredDays = perDay.size;
  return {
    offeredDays,
    offeredMinutes,
    requiredMinutes,
    requiredDays,
    missingDays: Math.max(0, Math.ceil((requiredMinutes - offeredMinutes) / MAX_COUNTED_MINUTES_PER_DAY)),
    complete: offeredMinutes >= requiredMinutes,
  };
}
