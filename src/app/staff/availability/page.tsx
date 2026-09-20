'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Kind = 'AVAILABLE' | 'PREFERRED' | 'UNAVAILABLE';

interface Day {
  onDate: string;
  kind: Kind;
  fromTime: string;
  toTime: string;
  note: string | null;
}

interface Workspace {
  period: {
    id: string;
    startsOn: string;
    endsOn: string;
    days: number;
    deadline: string | null;
    isOpen: boolean;
  } | null;
  contract: {
    employmentType: 'FULL_TIME' | 'PART_TIME' | 'ON_CALL';
    pensumPercent: number | null;
    weight: 'BINDING' | 'ADVISORY';
  } | null;
  corridor: { minMinutes: number; maxMinutes: number; hoursLabel: string } | null;
  days: Day[];
  defaultShiftEnd: string;
}

/** The two bands the restaurant actually runs, so most days are one tap. */
const PRESETS = [
  { label: 'Lunch', from: '10:30', to: '14:30' },
  { label: 'Dinner', from: '17:30', to: '22:00' },
  { label: 'All day', from: '10:30', to: '22:00' },
] as const;

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function eachDate(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${startsOn}T00:00:00Z`); t <= Date.parse(`${endsOn}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Monday = 0, to match how the roster is read. */
function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export default function AvailabilityPage() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/staff/availability', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) {
      setError('The month could not be loaded.');
      return;
    }
    setWs(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, Day>();
    ws?.days.forEach((d) => map.set(d.onDate, d));
    return map;
  }, [ws]);

  async function save(onDate: string, body: Record<string, unknown>) {
    setSaving(onDate);
    setError(null);
    try {
      const response = await fetch('/api/staff/availability', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ onDate, ...body }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'That day could not be saved.');
        return;
      }
      setWs(payload);
      setOpenDate(null);
    } catch {
      setError('That day could not be saved.');
    } finally {
      setSaving(null);
    }
  }

  if (error && !ws) {
    return <p className="p-6 text-danger-500">{error}</p>;
  }
  if (!ws) {
    return <p className="p-6 text-ink-muted">Loading…</p>;
  }
  if (!ws.period) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="font-display text-2xl text-ink">Availability</h1>
        <p className="mt-4 text-ink-muted">
          No month is collecting availability right now. You will be notified when the next one
          opens.
        </p>
      </main>
    );
  }

  const dates = eachDate(ws.period.startsOn, ws.period.endsOn);
  const locked = !ws.period.isOpen;
  const onCall = ws.contract?.employmentType === 'ON_CALL';

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <h1 className="font-display text-2xl text-ink">Availability</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {ws.period.startsOn} – {ws.period.endsOn} · {ws.period.days} days
      </p>

      {/* What this submission is worth depends on the contract behind it, so
          say which one the person is looking at rather than leaving them to
          guess whether "unavailable" is a request or a fact. */}
      <div className="mt-4 border-l-2 border-brand-600 bg-brand-50 p-3 text-sm text-ink">
        {onCall ? (
          <>
            <strong>Aushilfe.</strong> You are only ever rostered inside the hours you enter here.
            Days you leave blank are days you will not be asked to work.
          </>
        ) : (
          <>
            <strong>
              {ws.contract?.pensumPercent ?? '—'}% contract
              {ws.corridor ? ` · ${ws.corridor.hoursLabel} this month` : ''}
            </strong>{' '}
            — what you enter is taken as a preference. Your contracted hours still apply, so the
            plan may differ; you will be told if it does.
          </>
        )}
      </div>

      {ws.period.deadline && (
        <p className={`mt-3 text-sm ${locked ? 'text-danger-500' : 'text-ink-muted'}`}>
          {locked ? 'Closed for submissions on ' : 'Please submit by '}
          {new Date(ws.period.deadline).toLocaleString('de-CH', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </p>
      )}

      {error && <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">{error}</p>}

      <ul className="mt-6 divide-y divide-surface-sunken border-y border-surface-sunken">
        {dates.map((date) => {
          const entry = byDate.get(date);
          const isOpen = openDate === date;
          const busy = saving === date;

          return (
            <li key={date} className="py-2">
              <button
                type="button"
                disabled={locked}
                onClick={() => setOpenDate(isOpen ? null : date)}
                className="flex min-h-tap w-full items-center justify-between gap-3 px-1 text-left disabled:opacity-60"
              >
                <span className="flex items-baseline gap-2">
                  <span className="w-7 text-xs uppercase tracking-section text-ink-muted">
                    {WEEKDAYS[weekdayIndex(date)]}
                  </span>
                  <span className="font-display text-ink">{date.slice(8)}.{date.slice(5, 7)}.</span>
                </span>
                <span className="text-sm">
                  {busy ? (
                    <span className="text-ink-muted">Saving…</span>
                  ) : entry ? (
                    <Summary entry={entry} />
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </span>
              </button>

              {isOpen && !locked && (
                <div className="mt-2 bg-surface-sunken p-3">
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() =>
                          void save(date, { kind: 'AVAILABLE', fromTime: p.from, toTime: p.to })
                        }
                        className="min-h-tap border border-ink px-3 text-sm text-ink hover:bg-ink hover:text-surface"
                      >
                        {p.label}
                        <span className="ml-1 text-xs text-ink-muted">
                          {p.from}–{p.to}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => void save(date, { kind: 'UNAVAILABLE' })}
                      className="min-h-tap border border-danger-500 px-3 text-sm text-danger-500 hover:bg-danger-500 hover:text-surface"
                    >
                      Cannot work
                    </button>
                    {byDate.has(date) && (
                      <button
                        type="button"
                        onClick={() => void save(date, { kind: 'NONE' })}
                        className="min-h-tap px-3 text-sm text-ink-muted underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <CustomWindow
                    defaultEnd={ws.defaultShiftEnd}
                    entry={entry}
                    onSave={(from, to, preferred) =>
                      void save(date, {
                        kind: preferred ? 'PREFERRED' : 'AVAILABLE',
                        fromTime: from,
                        toTime: to,
                      })
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function Summary({ entry }: { entry: Day }) {
  if (entry.kind === 'UNAVAILABLE') {
    return <span className="text-danger-500">Cannot work</span>;
  }
  return (
    <span className="text-ink">
      {entry.fromTime}–{entry.toTime}
      {entry.kind === 'PREFERRED' && <span className="ml-1 text-brand-600">· preferred</span>}
    </span>
  );
}

function CustomWindow({
  defaultEnd,
  entry,
  onSave,
}: {
  defaultEnd: string;
  entry: Day | undefined;
  onSave: (from: string, to: string, preferred: boolean) => void;
}) {
  const [from, setFrom] = useState(entry?.kind === 'UNAVAILABLE' ? '10:30' : (entry?.fromTime ?? '10:30'));
  const [to, setTo] = useState(entry?.kind === 'UNAVAILABLE' ? defaultEnd : (entry?.toTime ?? defaultEnd));
  const [preferred, setPreferred] = useState(entry?.kind === 'PREFERRED');

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-surface pt-3">
      <label className="text-sm text-ink-muted">
        from{' '}
        <input
          type="time"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="min-h-tap border border-ink-muted bg-surface px-2 text-ink"
        />
      </label>
      <label className="text-sm text-ink-muted">
        to{' '}
        <input
          type="time"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="min-h-tap border border-ink-muted bg-surface px-2 text-ink"
        />
      </label>
      <label className="flex items-center gap-1 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={preferred}
          onChange={(e) => setPreferred(e.target.checked)}
          className="min-h-4"
        />
        I would prefer this
      </label>
      <button
        type="button"
        onClick={() => onSave(from, to, preferred)}
        className="min-h-tap bg-brand-600 px-4 text-sm text-surface hover:bg-brand-700"
      >
        Save
      </button>
    </div>
  );
}
