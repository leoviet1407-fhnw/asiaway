'use client';

import { useCallback, useEffect, useState } from 'react';

interface Line {
  userId: string;
  displayName: string;
  employmentType: string;
  pensumPercent: number | null;
  targetMinMinutes: number | null;
  targetMaxMinutes: number | null;
  plannedMinutes: number;
  workedMinutes: number;
  absenceDays: number;
  unapproved: number;
}

interface Statement {
  period: { startsOn: string; endsOn: string; state: string } | null;
  periodId?: string;
  periods?: { id: string; startsOn: string; endsOn: string; state: string }[];
  lines: Line[];
}

const hours = (m: number) => `${(m / 60).toFixed(1).replace('.0', '')} h`;

export default function MonthClosePage() {
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (periodId?: string) => {
    const response = await fetch(
      periodId ? `/api/manager/month-close?period=${periodId}` : '/api/manager/month-close',
      { cache: 'no-store' },
    );
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (response.status === 403) {
      setError('Only a manager can open this page.');
      return;
    }
    if (!response.ok) {
      setError('The month could not be loaded.');
      return;
    }
    setData(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function close() {
    if (!data?.periodId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/manager/month-close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ periodId: data.periodId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'The month could not be closed.');
        return;
      }
      setData({ ...data, ...payload });
    } finally {
      setBusy(false);
    }
  }

  function csv() {
    if (!data) return;
    const header = 'Name,Contract,Pensum,Planned h,Worked h,Difference h,Target min h,Target max h,Absence days';
    const body = data.lines
      .map((l) =>
        [
          l.displayName,
          l.employmentType,
          l.pensumPercent ?? '',
          (l.plannedMinutes / 60).toFixed(2),
          (l.workedMinutes / 60).toFixed(2),
          ((l.workedMinutes - l.plannedMinutes) / 60).toFixed(2),
          l.targetMinMinutes === null ? '' : (l.targetMinMinutes / 60).toFixed(2),
          l.targetMaxMinutes === null ? '' : (l.targetMaxMinutes / 60).toFixed(2),
          l.absenceDays,
        ].join(','),
      )
      .join('\n');

    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asiaway-hours-${data.period?.startsOn.slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error && !data) return <p className="p-6 text-danger-500">{error}</p>;
  if (!data) return <p className="p-6 text-ink-muted">Loading…</p>;
  if (!data.period) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="font-display text-2xl text-ink">Month close</h1>
        <p className="mt-4 text-ink-muted">No months exist yet.</p>
      </main>
    );
  }

  const unapproved = data.lines.reduce((total, l) => total + l.unapproved, 0);
  const locked = data.period.state === 'LOCKED';

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink">Month close</h1>
          <p className="text-sm text-ink-muted">
            {data.period.startsOn} – {data.period.endsOn} · {data.period.state.toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(data.periods?.length ?? 0) > 1 && (
            <select
              value={data.periodId}
              onChange={(e) => void load(e.target.value)}
              className="min-h-tap border border-ink-muted bg-surface px-2 text-sm text-ink"
            >
              {data.periods!.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.startsOn.slice(0, 7)} · {p.state.toLowerCase()}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={csv}
            className="min-h-tap border border-ink px-4 text-sm text-ink hover:bg-ink hover:text-surface"
          >
            Export CSV
          </button>
          <button
            type="button"
            disabled={busy || locked || unapproved > 0}
            title={unapproved > 0 ? `${unapproved} entries still need approving` : undefined}
            onClick={() => void close()}
            className="min-h-tap bg-brand-600 px-4 text-sm text-surface hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {locked ? 'Closed' : 'Close month'}
          </button>
        </div>
      </header>

      {error && (
        <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">{error}</p>
      )}
      {unapproved > 0 && !locked && (
        <p className="mt-3 border-l-2 border-warn-500 bg-warn-50 p-3 text-sm text-ink">
          {unapproved} time entr{unapproved === 1 ? 'y is' : 'ies are'} still unapproved. A statement
          with an unsettled entry in it is a draft, not a statement.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-surface-sunken text-left text-xs uppercase tracking-section text-ink-muted">
              <th className="p-2">Name</th>
              <th className="p-2">Contract</th>
              <th className="p-2 text-right">Planned</th>
              <th className="p-2 text-right">Worked</th>
              <th className="p-2 text-right">Difference</th>
              <th className="p-2 text-right">Contract band</th>
              <th className="p-2 text-right">Absence</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => {
              const variance = line.workedMinutes - line.plannedMinutes;
              const outside =
                line.targetMinMinutes !== null &&
                (line.workedMinutes < line.targetMinMinutes ||
                  line.workedMinutes > line.targetMaxMinutes!);
              return (
                <tr key={line.userId} className="border-b border-surface-sunken">
                  <td className="p-2 text-ink">{line.displayName}</td>
                  <td className="p-2 text-ink-muted">
                    {line.pensumPercent ? `${line.pensumPercent}%` : 'Aushilfe'}
                  </td>
                  <td className="p-2 text-right text-ink">{hours(line.plannedMinutes)}</td>
                  <td className="p-2 text-right text-ink">{hours(line.workedMinutes)}</td>
                  <td className="p-2 text-right text-ink">
                    {variance >= 0 ? '+' : '−'}
                    {hours(Math.abs(variance))}
                  </td>
                  <td className={`p-2 text-right ${outside ? 'text-warn-500' : 'text-ink-muted'}`}>
                    {line.targetMinMinutes === null
                      ? '—'
                      : `${(line.targetMinMinutes / 60).toFixed(0)}–${hours(line.targetMaxMinutes!)}`}
                  </td>
                  <td className="p-2 text-right text-ink-muted">
                    {line.absenceDays > 0 ? `${line.absenceDays} d` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-ink-muted">
        Hours only. Whether time inside the contract band is settled by salary or carried forward is
        a pay decision that has not been made, so nothing here says what anyone is owed.
      </p>
    </main>
  );
}
