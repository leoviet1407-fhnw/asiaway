'use client';

import { useCallback, useEffect, useState } from 'react';

interface Row {
  id: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  breakMinutes: number;
  workedMinutes: number;
  plannedMinutes: number | null;
  state: string;
  source: string;
  stationName: string | null;
  note: string | null;
}

interface Sheet {
  today: string;
  timeZone: string;
  from: string;
  to: string;
  rows: Row[];
  workedMinutes: number;
  plannedMinutes: number;
  varianceMinutes: number;
  corridor: { minMinutes: number; maxMinutes: number } | null;
  openEntryId: string | null;
}

const hours = (m: number) => `${(m / 60).toFixed(1).replace('.0', '')} h`;

const STATE_LABEL: Record<string, string> = {
  OPEN: 'Running',
  SUBMITTED: 'Waiting for approval',
  APPROVED: 'Approved',
  DISPUTED: 'Queried',
};

export default function TimesheetPage() {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [breakMinutes, setBreakMinutes] = useState(30);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/staff/timesheet', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) {
      setError('Your hours could not be loaded.');
      return;
    }
    setSheet(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/timesheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'That did not work.');
        return;
      }
      setSheet(payload);
      setDisputing(null);
      setReason('');
    } finally {
      setBusy(false);
    }
  }

  if (!sheet) return <p className="p-6 text-ink-muted">{error ?? 'Loading…'}</p>;

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('de-CH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: sheet.timeZone,
    });

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <h1 className="font-display text-2xl text-ink">My hours</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {sheet.from} – {sheet.to}
      </p>

      <section className="mt-4 bg-surface-sunken p-3">
        {sheet.openEntryId ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink">You are clocked in.</span>
            <label className="text-sm text-ink-muted">
              Break
              <input
                type="number"
                min={0}
                max={600}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(Number(e.target.value))}
                className="ml-2 min-h-tap w-20 border border-ink-muted bg-surface px-2 text-ink"
              />
              <span className="ml-1">min</span>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act({ action: 'clockOut', breakMinutes })}
              className="min-h-tap bg-brand-600 px-4 text-sm text-surface hover:bg-brand-700 disabled:opacity-50"
            >
              Clock out
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act({ action: 'clockIn' })}
            className="min-h-tap bg-brand-600 px-4 text-sm text-surface hover:bg-brand-700 disabled:opacity-50"
          >
            Clock in
          </button>
        )}
      </section>

      <dl className="mt-4 grid grid-cols-3 gap-px bg-surface-sunken text-center">
        <div className="bg-surface p-3">
          <dt className="text-xs uppercase tracking-section text-ink-muted">Worked</dt>
          <dd className="font-display text-lg text-ink">{hours(sheet.workedMinutes)}</dd>
        </div>
        <div className="bg-surface p-3">
          <dt className="text-xs uppercase tracking-section text-ink-muted">Planned</dt>
          <dd className="font-display text-lg text-ink">{hours(sheet.plannedMinutes)}</dd>
        </div>
        <div className="bg-surface p-3">
          <dt className="text-xs uppercase tracking-section text-ink-muted">Difference</dt>
          <dd className="font-display text-lg text-ink">
            {sheet.varianceMinutes >= 0 ? '+' : '−'}
            {hours(Math.abs(sheet.varianceMinutes))}
          </dd>
        </div>
      </dl>

      {sheet.corridor && (
        <p className="mt-2 text-sm text-ink-muted">
          Your contract for this period is {hours(sheet.corridor.minMinutes)}–
          {hours(sheet.corridor.maxMinutes)}.
        </p>
      )}
      <p className="mt-1 text-xs text-ink-muted">
        These are recorded hours, not a wage calculation. Nothing here says what is owed.
      </p>

      {error && (
        <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">{error}</p>
      )}

      <ul className="mt-6 divide-y divide-surface-sunken border-y border-surface-sunken">
        {sheet.rows.length === 0 && <li className="py-4 text-ink-muted">Nothing recorded yet.</li>}
        {sheet.rows.map((row) => (
          <li key={row.id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-ink">
                {row.businessDate.slice(8)}.{row.businessDate.slice(5, 7)}. · {time(row.clockInAt)}–
                {row.clockOutAt ? time(row.clockOutAt) : '…'}
              </p>
              <p className="text-sm text-ink">
                {hours(row.workedMinutes)}
                {row.plannedMinutes !== null && (
                  <span className="text-ink-muted"> of {hours(row.plannedMinutes)} planned</span>
                )}
              </p>
            </div>
            <p className="text-sm text-ink-muted">
              {row.stationName ?? 'Not planned'}
              {row.breakMinutes > 0 ? ` · ${row.breakMinutes} min break` : ''} ·{' '}
              <span className={row.state === 'DISPUTED' ? 'text-warn-500' : undefined}>
                {STATE_LABEL[row.state] ?? row.state}
              </span>
              {row.source === 'MANAGER' ? ' · entered by a manager' : ''}
            </p>

            {row.state !== 'OPEN' && row.state !== 'DISPUTED' && (
              <div className="mt-1">
                {disputing === row.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={reason}
                      placeholder="What is wrong with it?"
                      onChange={(e) => setReason(e.target.value)}
                      className="min-h-tap flex-1 border border-ink-muted bg-surface px-2 text-sm text-ink"
                    />
                    <button
                      type="button"
                      disabled={busy || !reason.trim()}
                      onClick={() => void act({ action: 'dispute', entryId: row.id, reason })}
                      className="min-h-tap bg-brand-600 px-3 text-sm text-surface disabled:opacity-50"
                    >
                      Send
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisputing(null)}
                      className="text-sm text-ink-muted underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDisputing(row.id)}
                    className="text-sm text-ink-muted underline decoration-dotted"
                  >
                    This is not right
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
