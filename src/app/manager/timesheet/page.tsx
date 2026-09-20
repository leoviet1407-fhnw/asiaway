'use client';

import { useCallback, useEffect, useState } from 'react';

interface Pending {
  id: string;
  userId: string;
  displayName: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  breakMinutes: number;
  workedMinutes: number;
  state: string;
  source: string;
  note: string | null;
  unplanned: boolean;
}

const hours = (m: number) => `${(m / 60).toFixed(1).replace('.0', '')} h`;

export default function ManagerTimesheetPage() {
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [breakMinutes, setBreakMinutes] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch('/api/manager/timesheet', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (response.status === 403) {
      setError('Only a manager can open this page.');
      return;
    }
    if (!response.ok) {
      setError('The entries could not be loaded.');
      return;
    }
    setPending((await response.json()).pending);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch('/api/manager/timesheet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'That did not work.');
        return;
      }
      setPending(payload.pending);
      setCorrecting(null);
      setReason('');
    } finally {
      setBusy(null);
    }
  }

  if (error && !pending) return <p className="p-6 text-danger-500">{error}</p>;
  if (!pending) return <p className="p-6 text-ink-muted">Loading…</p>;

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('de-CH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Zurich',
    });

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <h1 className="font-display text-2xl text-ink">Hours to approve</h1>
      <p className="mt-1 text-sm text-ink-muted">
        A correction never overwrites: the previous values are kept with your reason against them.
      </p>

      {error && (
        <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">{error}</p>
      )}

      {pending.length === 0 ? (
        <p className="mt-6 text-ink-muted">Nothing waiting.</p>
      ) : (
        <ul className="mt-6 divide-y divide-surface-sunken border-y border-surface-sunken">
          {pending.map((entry) => (
            <li key={entry.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-ink">
                  {entry.displayName} · {entry.businessDate.slice(8)}.{entry.businessDate.slice(5, 7)}. ·{' '}
                  {time(entry.clockInAt)}–{entry.clockOutAt ? time(entry.clockOutAt) : '…'}
                </p>
                <p className="text-sm text-ink">{hours(entry.workedMinutes)}</p>
              </div>
              <p className="text-sm text-ink-muted">
                {entry.breakMinutes} min break
                {entry.unplanned && <span className="text-warn-500"> · not planned</span>}
                {entry.state === 'DISPUTED' && <span className="text-warn-500"> · queried by them</span>}
                {entry.source === 'MANAGER' ? ' · entered by a manager' : ''}
                {entry.note ? ` · ${entry.note}` : ''}
              </p>

              {correcting === entry.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 bg-surface-sunken p-2">
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
                  </label>
                  <input
                    type="text"
                    value={reason}
                    placeholder="Why is it being changed?"
                    onChange={(e) => setReason(e.target.value)}
                    className="min-h-tap flex-1 border border-ink-muted bg-surface px-2 text-sm text-ink"
                  />
                  <button
                    type="button"
                    disabled={busy === entry.id || !reason.trim()}
                    onClick={() =>
                      void act(entry.id, {
                        action: 'correct',
                        entryId: entry.id,
                        breakMinutes,
                        reason,
                      })
                    }
                    className="min-h-tap bg-brand-600 px-3 text-sm text-surface disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setCorrecting(null)}
                    className="text-sm text-ink-muted underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy === entry.id}
                    onClick={() => void act(entry.id, { action: 'approve', entryId: entry.id })}
                    className="min-h-tap bg-brand-600 px-3 text-sm text-surface hover:bg-brand-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCorrecting(entry.id);
                      setBreakMinutes(entry.breakMinutes);
                    }}
                    className="min-h-tap border border-ink px-3 text-sm text-ink hover:bg-ink hover:text-surface"
                  >
                    Correct
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
