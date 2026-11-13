/**
 * Small charts drawn with plain HTML/SVG – no chart library, so they stay light on a phone.
 * They are server-renderable: every label is passed in already translated.
 */

const RED = '#ac2025';
const NAVY = '#09141d';
const GREEN = '#1f6b3a';
const LIGHT = '#e3e1df';

export interface BarRow {
  label: string;
  value: number;
  /** A marker on the bar, e.g. the monthly target. */
  target?: number | null;
  /** Text at the right end, already formatted. */
  text: string;
  color?: string;
  sub?: string;
}

/** Horizontal bars with an optional target marker. */
export function HBarChart({ rows, max, ariaLabel }: { rows: BarRow[]; max?: number; ariaLabel: string }) {
  const top = max ?? Math.max(1, ...rows.flatMap((r) => [r.value, r.target ?? 0]));
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-navy">{r.label}</span>
            <span className="whitespace-nowrap text-xs text-charcoal-muted">{r.text}</span>
          </div>
          <div className="relative mt-0.5 h-3.5 overflow-hidden rounded-full" style={{ background: LIGHT }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (Math.max(0, r.value) / top) * 100)}%`, background: r.color ?? RED }} />
            {r.target != null && r.target > 0 && <div className="absolute top-0 h-full w-0.5" style={{ left: `${Math.min(100, (r.target / top) * 100)}%`, background: NAVY }} title={String(r.target)} />}
          </div>
          {r.sub && <div className="text-[11px] text-charcoal-muted">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

export interface StackRow {
  label: string;
  segments: { value: number; color: string; title: string }[];
  text: string;
}

/** One stacked bar per row (e.g. holidays taken / requested / left). */
export function StackedBars({ rows, legend, ariaLabel }: { rows: StackRow[]; legend: { color: string; label: string }[]; ariaLabel: string }) {
  const top = Math.max(1, ...rows.map((r) => r.segments.reduce((s, x) => s + Math.max(0, x.value), 0)));
  return (
    <div>
      <ul className="space-y-2" aria-label={ariaLabel}>
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium text-navy">{r.label}</span>
              <span className="whitespace-nowrap text-xs text-charcoal-muted">{r.text}</span>
            </div>
            <div className="mt-0.5 flex h-3.5 overflow-hidden rounded-full" style={{ background: LIGHT }}>
              {r.segments.map((s, i) => (
                <div key={i} title={`${s.title}: ${s.value}`} style={{ width: `${(Math.max(0, s.value) / top) * 100}%`, background: s.color }} />
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-charcoal-muted">
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Bars to the right (plus, green) or left (minus, red) of a zero line. */
export function DivergingBars({ rows, ariaLabel }: { rows: { label: string; value: number; text: string }[]; ariaLabel: string }) {
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {rows.map((r) => {
        const pct = (Math.abs(r.value) / top) * 50;
        return (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium text-navy">{r.label}</span>
              <span className="whitespace-nowrap text-xs font-semibold" style={{ color: r.value < 0 ? RED : r.value > 0 ? GREEN : NAVY }}>{r.text}</span>
            </div>
            <div className="relative mt-0.5 h-3.5 rounded-full" style={{ background: LIGHT }}>
              <div className="absolute top-0 h-full w-px" style={{ left: '50%', background: NAVY }} />
              <div className="absolute top-0 h-full rounded-full" style={{ width: `${pct}%`, left: r.value >= 0 ? '50%' : `${50 - pct}%`, background: r.value < 0 ? RED : GREEN }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export interface Column {
  label: string;
  value: number;
  text: string;
  sub?: string;
  highlight?: boolean;
}

/** Vertical columns (e.g. hours per weekday, sales per day). */
export function ColumnChart({ items, height = 140, color = RED, ariaLabel, showEvery = 1 }: { items: Column[]; height?: number; color?: string; ariaLabel: string; showEvery?: number }) {
  const top = Math.max(1, ...items.map((i) => i.value));
  const w = 100 / items.length;
  return (
    <figure aria-label={ariaLabel}>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
        <line x1="0" x2="100" y1={height / 4 - 0.4} y2={height / 4 - 0.4} stroke={LIGHT} strokeWidth="0.8" />
        {items.map((it, i) => {
          const h = (it.value / top) * (height / 4 - 3);
          return <rect key={it.label + i} x={i * w + w * 0.15} width={w * 0.7} y={height / 4 - 0.4 - h} height={Math.max(0, h)} rx="0.6" fill={it.highlight ? NAVY : color}><title>{`${it.label}: ${it.text}`}</title></rect>;
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-charcoal-muted">
        {items.map((it, i) => (
          <div key={it.label + i} className="text-center" style={{ width: `${w}%` }}>
            {i % showEvery === 0 ? it.label : ''}
            {it.sub && i % showEvery === 0 ? <div className="font-semibold text-navy">{it.sub}</div> : null}
          </div>
        ))}
      </div>
    </figure>
  );
}
