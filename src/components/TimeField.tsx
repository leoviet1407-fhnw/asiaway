'use client';

/**
 * A time of day ("HH:MM") with the phone's own time wheel (type="time", 15-minute steps)
 * and −/+ buttons for quick 15-minute changes. Typing "1030" or "10.30" also works.
 */
const STEP = 15;

const toMin = (v: string): number | null => {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
};
const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Normalises "1030" / "10.30" / "9:00" to "10:30" / "09:00"; anything else is returned as typed. */
export function normalizeTime(v: string): string {
  const m = toMin(v);
  return m === null ? v : fmt(m);
}

export function TimeField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const step = (delta: number) => {
    const cur = toMin(value);
    const base = cur === null ? 12 * 60 : Math.round(cur / STEP) * STEP;
    onChange(fmt((((base + delta) % 1440) + 1440) % 1440));
  };
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex items-stretch gap-1">
        <button type="button" className="btn-secondary min-h-0 px-2.5 py-1 text-lg leading-none" aria-label={`${label} −15 min`} onClick={() => step(-STEP)}>−</button>
        <input
          id={id}
          type="time"
          step={STEP * 60}
          className="w-full min-w-0 text-center tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onChange(normalizeTime(e.target.value))}
        />
        <button type="button" className="btn-secondary min-h-0 px-2.5 py-1 text-lg leading-none" aria-label={`${label} +15 min`} onClick={() => step(STEP)}>+</button>
      </div>
    </div>
  );
}
