'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Violation {
  code: string;
  severity: 'BLOCK' | 'WARN' | 'INFO';
  userId: string | null;
  onDate: string | null;
  shiftIds: string[];
  message: string;
}

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
    acknowledged: boolean;
  }[];
  people: { id: string; name: string; employmentType: string; pensumPercent: number | null }[];
  periods?: { id: string; startsOn: string; endsOn: string; state: string }[];
  violations: Violation[];
  canPublish: boolean;
  published?: boolean;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAYS_SHOWN = 7;

export default function ManagerRosterPage() {
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [weekStart, setWeekStart] = useState(0);
  const [fixing, setFixing] = useState<{ userId: string; onDate: string } | null>(null);

  const load = useCallback(async (periodId?: string) => {
    const response = await fetch(
      periodId ? `/api/manager/roster?period=${periodId}` : '/api/manager/roster',
      { cache: 'no-store' },
    );
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (response.status === 403) {
      setError('Only a manager can open the roster.');
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

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/manager/roster', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'That did not work.');
        return;
      }
      // An action returns the grid it acted on, without the selector list.
      setGrid((previous) => ({ ...payload, periods: payload.periods ?? previous?.periods }));
    } finally {
      setBusy(false);
    }
  }

  /** Violations indexed by the shift they touch, so a cell can show its own. */
  const worstByShift = useMemo(() => {
    const map = new Map<string, Violation['severity']>();
    for (const violation of grid?.violations ?? []) {
      for (const id of violation.shiftIds) {
        const current = map.get(id);
        if (!current || (current !== 'BLOCK' && violation.severity === 'BLOCK')) {
          map.set(id, violation.severity);
        }
      }
    }
    return map;
  }, [grid]);

  /**
   * Records the hours a person actually offered, from the finding that says
   * they were not offered. Generating a month closes it to staff, so without
   * this an Aushilfe who phones in late cannot be rostered at all.
   */
  async function recordAvailability(userId: string, onDate: string, from: string, to: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/manager/availability', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, onDate, kind: 'AVAILABLE', fromTime: from, toTime: to }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error?.message ?? 'That could not be recorded.');
        return;
      }
      setFixing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error && !grid) return <p className="p-6 text-danger-500">{error}</p>;
  if (!grid) return <p className="p-6 text-ink-muted">Loading…</p>;
  if (!grid.period) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="font-display text-2xl text-ink">Roster</h1>
        <p className="mt-4 text-ink-muted">No roster period exists yet.</p>
      </main>
    );
  }

  const dates = grid.dates.slice(weekStart, weekStart + DAYS_SHOWN);
  const blocking = grid.violations.filter((v) => v.severity === 'BLOCK');
  const warnings = grid.violations.filter((v) => v.severity === 'WARN');
  const visibleStations = grid.stations.filter((s) => s.policy !== 'CLOSED');
  const nameOf = (id: string | null): string =>
    grid.people.find((p) => p.id === id)?.name ?? '';

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-24 pt-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink">Roster</h1>
          <p className="text-sm text-ink-muted">
            {grid.period.startsOn} – {grid.period.endsOn} · {grid.period.state}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(grid.periods?.length ?? 0) > 1 && (
            <select
              value={grid.period.id}
              onChange={(e) => void load(e.target.value)}
              className="min-h-tap border border-ink-muted bg-surface px-2 text-sm text-ink"
            >
              {grid.periods!.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.startsOn.slice(0, 7)} · {p.state.toLowerCase().replace('_', ' ')}
                </option>
              ))}
            </select>
          )}
          {grid.shifts.length === 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act({ action: 'generate', periodId: grid.period!.id })}
              className="min-h-tap border border-ink px-4 text-sm text-ink hover:bg-ink hover:text-surface disabled:opacity-50"
            >
              Generate from templates
            </button>
          )}
          <button
            type="button"
            disabled={busy || !grid.canPublish}
            title={grid.canPublish ? undefined : 'Clear the blocking findings first'}
            onClick={() => void act({ action: 'publish', periodId: grid.period!.id })}
            className="min-h-tap bg-brand-600 px-4 text-sm text-surface hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Publish
          </button>
        </div>
      </header>

      {error && (
        <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">{error}</p>
      )}
      {grid.published && (
        <p className="mt-3 border-l-2 border-brand-600 bg-brand-50 p-3 text-sm text-ink">
          Published. Everyone rostered can now see their shifts and confirm them.
        </p>
      )}

      {grid.dates.length > DAYS_SHOWN && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <button
            type="button"
            disabled={weekStart === 0}
            onClick={() => setWeekStart(Math.max(0, weekStart - DAYS_SHOWN))}
            className="min-h-tap border border-ink-muted px-3 text-ink disabled:opacity-40"
          >
            ← earlier
          </button>
          <span className="text-ink-muted">
            {dates[0]} – {dates[dates.length - 1]}
          </span>
          <button
            type="button"
            disabled={weekStart + DAYS_SHOWN >= grid.dates.length}
            onClick={() => setWeekStart(weekStart + DAYS_SHOWN)}
            className="min-h-tap border border-ink-muted px-3 text-ink disabled:opacity-40"
          >
            later →
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface p-2 text-left text-xs uppercase tracking-section text-ink-muted">
                Station
              </th>
              {dates.map((date) => (
                <th key={date} className="min-w-[150px] border-b border-surface-sunken p-2 text-left">
                  <span className="text-xs uppercase tracking-section text-ink-muted">
                    {WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}{' '}
                  </span>
                  <span className="font-display text-ink">
                    {date.slice(8)}.{date.slice(5, 7)}.
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleStations.map((station) => (
              <tr key={station.code} className="align-top">
                <th className="sticky left-0 z-10 max-w-[180px] bg-surface p-2 text-left font-normal text-ink">
                  {station.name}
                  {station.policy === 'SELF_SERVE' && (
                    <span className="block text-xs text-ink-muted">Kellner selbst</span>
                  )}
                </th>
                {dates.map((date) => {
                  const cells = grid.shifts.filter(
                    (s) => s.onDate === date && s.stationCode === station.code,
                  );
                  return (
                    <td key={date} className="border-b border-surface-sunken p-1">
                      {cells.length === 0 && station.policy === 'STAFFED' && (
                        <span className="text-xs text-ink-muted">—</span>
                      )}
                      {cells.map((cell) => {
                        const severity = worstByShift.get(cell.id);
                        const border =
                          severity === 'BLOCK'
                            ? 'border-danger-500'
                            : severity === 'WARN'
                              ? 'border-warn-500'
                              : 'border-surface-sunken';
                        return (
                          <div key={cell.id} className={`mb-1 border-l-2 ${border} bg-surface-sunken p-1`}>
                            <p className="text-xs text-ink-muted">
                              {cell.from}–{cell.to}
                              {cell.roleLabel ? ` · ${cell.roleLabel}` : ''}
                            </p>
                            <select
                              value={cell.userId ?? ''}
                              disabled={busy}
                              onChange={(e) =>
                                void act({
                                  action: 'assign',
                                  shiftId: cell.id,
                                  userId: e.target.value || null,
                                })
                              }
                              className={`mt-1 min-h-tap w-full border bg-surface px-1 text-ink ${
                                cell.userId ? 'border-ink-muted' : 'border-dashed border-warn-500'
                              }`}
                            >
                              <option value="">— open —</option>
                              {grid.people.map((person) => (
                                <option key={person.id} value={person.id}>
                                  {person.name}
                                  {person.pensumPercent ? ` ${person.pensumPercent}%` : ' (Aushilfe)'}
                                </option>
                              ))}
                            </select>
                            {cell.acknowledged && (
                              <p className="mt-0.5 text-xs text-ink-muted">✓ confirmed</p>
                            )}
                          </div>
                        );
                      })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-8">
        <h2 className="font-display text-lg text-ink">
          Findings
          <span className="ml-2 text-sm font-normal text-ink-muted">
            {blocking.length} blocking · {warnings.length} to look at
          </span>
        </h2>
        {grid.violations.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing to flag.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {grid.violations.slice(0, 60).map((violation, index) => (
              <li
                key={`${violation.code}-${index}`}
                className={`border-l-2 p-2 ${
                  violation.severity === 'BLOCK'
                    ? 'border-danger-500 bg-danger-50 text-danger-500'
                    : violation.severity === 'WARN'
                      ? 'border-warn-500 bg-warn-50 text-ink'
                      : 'border-surface-sunken bg-surface-sunken text-ink-muted'
                }`}
              >
                <span className="mr-2 text-xs uppercase tracking-section opacity-70">
                  {violation.code}
                </span>
                {violation.message}
                {(violation.code === 'R8A_ON_CALL_OUTSIDE' ||
                  violation.code === 'R8B_AGAINST_PREF') &&
                  violation.userId &&
                  violation.onDate && (
                    <AvailabilityFix
                      open={
                        fixing?.userId === violation.userId && fixing?.onDate === violation.onDate
                      }
                      busy={busy}
                      name={nameOf(violation.userId)}
                      onOpen={() =>
                        setFixing({ userId: violation.userId!, onDate: violation.onDate! })
                      }
                      onCancel={() => setFixing(null)}
                      onSave={(from, to) =>
                        void recordAvailability(violation.userId!, violation.onDate!, from, to)
                      }
                    />
                  )}
              </li>
            ))}
          </ul>
        )}
        {grid.violations.length > 60 && (
          <p className="mt-2 text-sm text-ink-muted">
            …and {grid.violations.length - 60} more.
          </p>
        )}
      </section>
    </main>
  );
}

/**
 * The remedy offered beside the finding that names it.
 *
 * A manager entering hours on someone's behalf is a statement about that
 * person, so the write is audited against the manager who made it.
 */
function AvailabilityFix({
  open,
  busy,
  name,
  onOpen,
  onCancel,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  name: string;
  onOpen: () => void;
  onCancel: () => void;
  onSave: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState('17:30');
  const [to, setTo] = useState('22:00');

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="ml-2 underline decoration-dotted underline-offset-2"
      >
        Record their hours
      </button>
    );
  }

  return (
    <span className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">{name} can work</span>
      <input
        type="time"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="min-h-tap border border-ink-muted bg-surface px-1 text-ink"
      />
      <span className="text-xs text-ink-muted">to</span>
      <input
        type="time"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="min-h-tap border border-ink-muted bg-surface px-1 text-ink"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onSave(from, to)}
        className="min-h-tap bg-brand-600 px-3 text-xs text-surface hover:bg-brand-700 disabled:opacity-50"
      >
        Save
      </button>
      <button type="button" onClick={onCancel} className="text-xs text-ink-muted underline">
        Cancel
      </button>
    </span>
  );
}
