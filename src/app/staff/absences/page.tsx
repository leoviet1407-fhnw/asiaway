'use client';

import { useCallback, useEffect, useState } from 'react';

interface Absence {
  id: string;
  startsOn: string;
  endsOn: string;
  absenceType: string;
  state: string;
  note: string | null;
}

const TYPES = [
  { value: 'VACATION', label: 'Holiday' },
  { value: 'SICK', label: 'Sick' },
  { value: 'MILITARY', label: 'Military service' },
  { value: 'UNPAID', label: 'Unpaid leave' },
] as const;

const STATE_LABEL: Record<string, string> = {
  REQUESTED: 'Waiting for a decision',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
};

export default function AbsencesPage() {
  const [absences, setAbsences] = useState<Absence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [absenceType, setAbsenceType] = useState<string>('VACATION');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const response = await fetch('/api/staff/absences', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) {
      setError('Your requests could not be loaded.');
      return;
    }
    setAbsences((await response.json()).absences);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!startsOn || !endsOn) {
      setError('Please give a first and a last day.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/staff/absences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startsOn, endsOn, absenceType, note: note || undefined }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'That could not be requested.');
        return;
      }
      setAbsences(payload.absences);
      setStartsOn('');
      setEndsOn('');
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  if (!absences) return <p className="p-6 text-ink-muted">{error ?? 'Loading…'}</p>;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <h1 className="font-display text-2xl text-ink">Time off</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Approved days are blocked on the roster, so nobody can be planned onto them.
      </p>

      {error && (
        <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">{error}</p>
      )}

      <section className="mt-6 bg-surface-sunken p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-ink-muted">
            From
            <input
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              className="ml-2 min-h-tap border border-ink-muted bg-surface px-2 text-ink"
            />
          </label>
          <label className="text-sm text-ink-muted">
            To
            <input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="ml-2 min-h-tap border border-ink-muted bg-surface px-2 text-ink"
            />
          </label>
          <label className="text-sm text-ink-muted">
            Reason
            <select
              value={absenceType}
              onChange={(e) => setAbsenceType(e.target.value)}
              className="ml-2 min-h-tap border border-ink-muted bg-surface px-2 text-ink"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          type="text"
          value={note}
          placeholder="Anything the manager should know (optional)"
          onChange={(e) => setNote(e.target.value)}
          className="mt-3 min-h-tap w-full border border-ink-muted bg-surface px-2 text-ink"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-3 min-h-tap bg-brand-600 px-4 text-sm text-surface hover:bg-brand-700 disabled:opacity-50"
        >
          Request
        </button>
      </section>

      <ul className="mt-6 divide-y divide-surface-sunken border-y border-surface-sunken">
        {absences.length === 0 && <li className="py-4 text-ink-muted">Nothing requested yet.</li>}
        {absences.map((absence) => (
          <li key={absence.id} className="py-3">
            <p className="font-display text-ink">
              {absence.startsOn} – {absence.endsOn}
            </p>
            <p className="text-sm text-ink-muted">
              {TYPES.find((t) => t.value === absence.absenceType)?.label ?? absence.absenceType} ·{' '}
              <span
                className={
                  absence.state === 'APPROVED'
                    ? 'text-ink'
                    : absence.state === 'REJECTED'
                      ? 'text-danger-500'
                      : 'text-warn-500'
                }
              >
                {STATE_LABEL[absence.state] ?? absence.state}
              </span>
              {absence.note ? ` · ${absence.note}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
