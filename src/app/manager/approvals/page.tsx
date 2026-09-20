'use client';

import { useCallback, useEffect, useState } from 'react';

interface Pending {
  id: string;
  userId: string;
  displayName: string;
  startsOn: string;
  endsOn: string;
  absenceType: string;
  note: string | null;
  requestedAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  VACATION: 'Holiday',
  SICK: 'Sick',
  MILITARY: 'Military service',
  UNPAID: 'Unpaid leave',
  PUBLIC_HOLIDAY: 'Public holiday',
};

export default function ApprovalsPage() {
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/manager/absences', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (response.status === 403) {
      setError('Only a manager can open this page.');
      return;
    }
    if (!response.ok) {
      setError('The requests could not be loaded.');
      return;
    }
    setPending((await response.json()).pending);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(absenceId: string, decision: 'APPROVED' | 'REJECTED') {
    setBusy(absenceId);
    setError(null);
    try {
      const response = await fetch('/api/manager/absences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ absenceId, decision }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? 'That could not be recorded.');
        return;
      }
      setPending(payload.pending);
    } finally {
      setBusy(null);
    }
  }

  if (error && !pending) return <p className="p-6 text-danger-500">{error}</p>;
  if (!pending) return <p className="p-6 text-ink-muted">Loading…</p>;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <h1 className="font-display text-2xl text-ink">Time-off requests</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Approving blocks those days on the roster, so nobody can be planned onto them.
      </p>

      {error && (
        <p className="mt-3 border border-danger-500 bg-danger-50 p-3 text-sm text-danger-500">{error}</p>
      )}

      {pending.length === 0 ? (
        <p className="mt-6 text-ink-muted">Nothing waiting.</p>
      ) : (
        <ul className="mt-6 divide-y divide-surface-sunken border-y border-surface-sunken">
          {pending.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-display text-ink">
                  {request.displayName} · {request.startsOn} – {request.endsOn}
                </p>
                <p className="text-sm text-ink-muted">
                  {TYPE_LABEL[request.absenceType] ?? request.absenceType}
                  {request.note ? ` · ${request.note}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() => void decide(request.id, 'APPROVED')}
                  className="min-h-tap bg-brand-600 px-3 text-sm text-surface hover:bg-brand-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() => void decide(request.id, 'REJECTED')}
                  className="min-h-tap border border-danger-500 px-3 text-sm text-danger-500 hover:bg-danger-500 hover:text-surface disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
