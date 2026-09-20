'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Grid {
  period: { id: string; startsOn: string; endsOn: string; state: string } | null;
  dates: string[];
  stations: { code: string; name: string; policy: string }[];
  shifts: {
    id: string;
    onDate: string;
    stationCode: string;
    userId: string | null;
    from: string;
    to: string;
    roleLabel: string | null;
    policy: string;
  }[];
  people: { id: string; name: string; employmentType: string; pensumPercent: number | null }[];
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/**
 * The plan on paper: the station view and the person view, the same two pages
 * the restaurant already pins to the wall.
 *
 * Both are rendered from `shifts`, which is the whole point — the September
 * 2026 pair were maintained by hand and Sunday's four shifts ended up swapped
 * between them. These two cannot disagree, because there is only one table.
 *
 * Printed rather than exported: the browser's own "Save as PDF" produces the
 * file, so there is no PDF library in the bundle or on a cold start.
 */
export default function RosterPrintPage() {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch('/api/manager/roster', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) {
      setError('The roster could not be loaded.');
      return;
    }
    setGrid(await response.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const weeks = useMemo(() => {
    if (!grid) return [];
    const out: string[][] = [];
    for (let i = 0; i < grid.dates.length; i += 7) out.push(grid.dates.slice(i, i + 7));
    return out;
  }, [grid]);

  if (error) return <p className="p-6 text-danger-500">{error}</p>;
  if (!grid || !grid.period) return <p className="p-6 text-ink-muted">Loading…</p>;

  const dates = weeks[week] ?? [];
  const nameOf = (id: string | null): string =>
    id ? (grid.people.find((p) => p.id === id)?.name ?? '?') : '—';

  const rostered = grid.people.filter((person) =>
    grid.shifts.some((s) => s.userId === person.id && dates.includes(s.onDate)),
  );

  return (
    <main className="mx-auto max-w-[1400px] p-6 print:p-0">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .no-print { display: none !important; }
          .page-break { break-before: page; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        {weeks.map((w, index) => (
          <button
            key={w[0]}
            type="button"
            onClick={() => setWeek(index)}
            className={`min-h-tap border px-3 text-sm ${
              index === week ? 'border-ink bg-ink text-surface' : 'border-ink-muted text-ink'
            }`}
          >
            {w[0]!.slice(8)}.{w[0]!.slice(5, 7)}.
          </button>
        ))}
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-tap bg-brand-600 px-4 text-sm text-surface hover:bg-brand-700"
        >
          Print / Save as PDF
        </button>
        <span className="text-sm text-ink-muted">
          Two pages: stations, then people. Both from the same table.
        </span>
      </div>

      {/* Page 1 — the station plan. */}
      <section>
        <h1 className="font-display text-xl text-ink">
          ASIAWAY — Service Station Plan
          <span className="ml-3 text-sm font-normal text-ink-muted">
            {dates[0]} – {dates[dates.length - 1]}
          </span>
        </h1>
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="border border-ink-muted p-1 text-left">Station</th>
              {dates.map((date) => (
                <th key={date} className="border border-ink-muted p-1 text-left">
                  {WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} {date.slice(8)}.{date.slice(5, 7)}.
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.stations
              .filter((s) => s.policy !== 'CLOSED')
              .map((station) => (
                <tr key={station.code}>
                  <th className="border border-ink-muted p-1 text-left font-normal">{station.name}</th>
                  {dates.map((date) => {
                    const cells = grid.shifts
                      .filter((s) => s.onDate === date && s.stationCode === station.code)
                      .sort((a, b) => a.from.localeCompare(b.from));
                    return (
                      <td key={date} className="border border-ink-muted p-1 align-top">
                        {cells.length === 0 && <span className="text-ink-muted">—</span>}
                        {cells.map((cell) => (
                          <div key={cell.id}>
                            <span className="text-ink-muted">
                              {cell.from}–{cell.to}{' '}
                            </span>
                            {cell.policy === 'SELF_SERVE' ? (
                              <em className="text-ink-muted">Kellner selbst</em>
                            ) : (
                              <strong>{nameOf(cell.userId)}</strong>
                            )}
                            {cell.roleLabel ? (
                              <span className="text-ink-muted"> · {cell.roleLabel}</span>
                            ) : null}
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      {/* Page 2 — the same shifts, read by person. */}
      <section className="page-break mt-10 print:mt-0">
        <h1 className="font-display text-xl text-ink">
          ASIAWAY — Arbeitsplan (nach Uhrzeit)
          <span className="ml-3 text-sm font-normal text-ink-muted">
            {dates[0]} – {dates[dates.length - 1]}
          </span>
        </h1>
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="border border-ink-muted p-1 text-left">Service-Team</th>
              {dates.map((date) => (
                <th key={date} className="border border-ink-muted p-1 text-left">
                  {WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} {date.slice(8)}.{date.slice(5, 7)}.
                </th>
              ))}
              <th className="border border-ink-muted p-1 text-left">Total</th>
            </tr>
          </thead>
          <tbody>
            {rostered.map((person) => {
              const own = grid.shifts.filter((s) => s.userId === person.id);
              const minutes = own
                .filter((s) => dates.includes(s.onDate))
                .reduce((total, s) => {
                  const [fh, fm] = s.from.split(':').map(Number);
                  const [th, tm] = s.to.split(':').map(Number);
                  let span = th! * 60 + tm! - (fh! * 60 + fm!);
                  if (span < 0) span += 1440;
                  return total + span;
                }, 0);

              return (
                <tr key={person.id}>
                  <th className="border border-ink-muted p-1 text-left font-normal">
                    {person.name}
                    <span className="block text-ink-muted">
                      {person.pensumPercent ? `Pensum: ${person.pensumPercent}%` : 'Aushilfe'}
                    </span>
                  </th>
                  {dates.map((date) => {
                    const cells = own
                      .filter((s) => s.onDate === date)
                      .sort((a, b) => a.from.localeCompare(b.from));
                    return (
                      <td key={date} className="border border-ink-muted p-1 align-top">
                        {cells.length === 0 ? (
                          <span className="text-ink-muted">—</span>
                        ) : (
                          cells.map((cell) => (
                            <div key={cell.id}>
                              {cell.from} – {cell.to}
                            </div>
                          ))
                        )}
                      </td>
                    );
                  })}
                  <td className="border border-ink-muted p-1 font-display">
                    {(minutes / 60).toFixed(1).replace('.0', '')} h
                  </td>
                </tr>
              );
            })}
            {rostered.length === 0 && (
              <tr>
                <td className="border border-ink-muted p-2 text-ink-muted" colSpan={dates.length + 2}>
                  Nobody is assigned in this week yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-ink-muted">
          Every shift has a start and an end. Hours are the planned span, before breaks.
        </p>
      </section>
    </main>
  );
}
