'use client';

import { useCallback, useEffect, useState } from 'react';

interface Shift {
  id: string;
  onDate: string;
  stationName: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  roleLabel: string | null;
  acknowledged: boolean;
}

interface Payload {
  today: string;
  timeZone: string;
  shifts: Shift[];
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export default function SchedulePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/staff/schedule', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) {
      setError('Your schedule could not be loaded.');
      return;
    }
    setData(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function acknowledge(shiftId: string) {
    setBusy(shiftId);
    try {
      const response = await fetch('/api/staff/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shiftId }),
      });
      if (response.ok) setData(await response.json());
      else setError('That could not be confirmed.');
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return <p className="p-6 text-ink-muted">{error ?? 'Loading…'}</p>;
  }

  const time = (iso: string): string =>
    new Date(iso).toLocaleTimeString('de-CH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: data.timeZone,
    });

  const unconfirmed = data.shifts.filter((s) => !s.acknowledged).length;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <h1 className="font-display text-2xl text-ink">My shifts</h1>

      {data.shifts.length === 0 ? (
        <p className="mt-4 text-ink-muted">
          Nothing published yet. You will be notified when the next plan goes out.
        </p>
      ) : (
        <>
          {unconfirmed > 0 && (
            <p className="mt-3 border-l-2 border-brand-600 bg-brand-50 p-3 text-sm text-ink">
              {unconfirmed} shift{unconfirmed === 1 ? '' : 's'} still to confirm. Tap
              &ldquo;Got it&rdquo; so the plan knows you have seen them.
            </p>
          )}
          {error && (
            <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">
              {error}
            </p>
          )}

          <ul className="mt-6 divide-y divide-surface-sunken border-y border-surface-sunken">
            {data.shifts.map((shift) => {
              const date = new Date(`${shift.onDate}T00:00:00Z`);
              return (
                <li key={shift.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-display text-ink">
                      <span className="text-ink-muted">{WEEKDAYS[date.getUTCDay()]} </span>
                      {shift.onDate.slice(8)}.{shift.onDate.slice(5, 7)}. · {time(shift.startsAt)}–
                      {time(shift.endsAt)}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {shift.stationName}
                      {shift.roleLabel ? ` · ${shift.roleLabel}` : ''}
                      {shift.breakMinutes > 0 ? ` · ${shift.breakMinutes} min break` : ''}
                    </p>
                  </div>
                  {shift.acknowledged ? (
                    <span className="shrink-0 text-sm text-ink-muted">Confirmed</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === shift.id}
                      onClick={() => void acknowledge(shift.id)}
                      className="min-h-tap shrink-0 border border-ink px-3 text-sm text-ink hover:bg-ink hover:text-surface disabled:opacity-50"
                    >
                      {busy === shift.id ? '…' : 'Got it'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
