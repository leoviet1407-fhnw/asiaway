'use client';

import { useCallback, useEffect, useState } from 'react';

interface Period {
  id: string;
  startsOn: string;
  endsOn: string;
  state: string;
  availabilityDeadline: string | null;
  publishedAt: string | null;
  shiftCount: number;
}

/** Forward only; mirrors ALLOWED_NEXT in period-service.ts. */
const NEXT: Record<string, string[]> = {
  DRAFT: ['AVAILABILITY_OPEN', 'PLANNING'],
  AVAILABILITY_OPEN: ['PLANNING'],
  PLANNING: ['AVAILABILITY_OPEN', 'PUBLISHED'],
  PUBLISHED: ['PLANNING', 'LOCKED'],
  LOCKED: [],
};

const LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  AVAILABILITY_OPEN: 'Collecting availability',
  PLANNING: 'Planning',
  PUBLISHED: 'Published',
  LOCKED: 'Locked',
};

function nextFirstOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export default function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstDay, setFirstDay] = useState(nextFirstOfMonth());
  const [deadline, setDeadline] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/manager/periods', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (response.status === 403) {
      setError('Only a manager can open this page.');
      return;
    }
    if (!response.ok) {
      setError('The months could not be loaded.');
      return;
    }
    setPeriods((await response.json()).periods);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/manager/periods', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'That did not work.');
        return;
      }
      setPeriods(payload.periods);
    } finally {
      setBusy(false);
    }
  }

  if (error && !periods) return <p className="p-6 text-danger-500">{error}</p>;
  if (!periods) return <p className="p-6 text-ink-muted">Loading…</p>;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <h1 className="font-display text-2xl text-ink">Months</h1>
      <p className="mt-1 text-sm text-ink-muted">
        A month collects availability, then gets planned, then published. Moves are forward only.
      </p>

      {error && (
        <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">{error}</p>
      )}

      <section className="mt-6 bg-surface-sunken p-3">
        <h2 className="font-display text-ink">New month</h2>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-sm text-ink-muted">
            First day
            <input
              type="date"
              value={firstDay}
              onChange={(e) => setFirstDay(e.target.value)}
              className="ml-2 min-h-tap border border-ink-muted bg-surface px-2 text-ink"
            />
          </label>
          <label className="text-sm text-ink-muted">
            Availability deadline
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="ml-2 min-h-tap border border-ink-muted bg-surface px-2 text-ink"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act({
                action: 'create',
                firstDay,
                deadline: deadline ? new Date(deadline).toISOString() : null,
              })
            }
            className="min-h-tap bg-brand-600 px-4 text-sm text-surface hover:bg-brand-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          The last day is derived from the first, so a month is always a whole month.
        </p>
      </section>

      <ul className="mt-6 divide-y divide-surface-sunken border-y border-surface-sunken">
        {periods.length === 0 && <li className="py-4 text-ink-muted">No months yet.</li>}
        {periods.map((period) => (
          <li key={period.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-display text-ink">
                {period.startsOn} – {period.endsOn}
              </p>
              <p className="text-sm text-ink-muted">
                {LABEL[period.state] ?? period.state} · {period.shiftCount} shifts
                {period.availabilityDeadline
                  ? ` · deadline ${new Date(period.availabilityDeadline).toLocaleString('de-CH', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}`
                  : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(NEXT[period.state] ?? []).map((state) => (
                <button
                  key={state}
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: 'setState', periodId: period.id, state })}
                  className="min-h-tap border border-ink px-3 text-sm text-ink hover:bg-ink hover:text-surface disabled:opacity-50"
                >
                  → {LABEL[state] ?? state}
                </button>
              ))}
              {NEXT[period.state]?.length === 0 && (
                <span className="text-sm text-ink-muted">Closed</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
