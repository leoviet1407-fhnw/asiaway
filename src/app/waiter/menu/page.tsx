'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatMoney } from '../../../lib/format';

interface AvailabilityRow {
  id: string;
  dishNumber: string | null;
  volume: string | null;
  nameEn: string;
  priceCents: number;
  isAvailable: boolean;
  categoryName: string;
}

/**
 * Sold-out management.
 *
 * Optimistic: the toggle flips at once because a waiter on the floor should not
 * wait on a round trip — and rolls back visibly if the server refuses.
 */
export default function WaiterMenuPage() {
  const [items, setItems] = useState<AvailabilityRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/waiter/menu-items');
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) return;
    const data = await response.json();
    setItems(data.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(row: AvailabilityRow) {
    const next = !row.isAvailable;
    setError(null);
    setItems((current) =>
      (current ?? []).map((i) => (i.id === row.id ? { ...i, isAvailable: next } : i)),
    );

    try {
      const response = await fetch(`/api/waiter/menu-items/${row.id}/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: next }),
      });
      if (!response.ok) throw new Error('failed');
    } catch {
      setItems((current) =>
        (current ?? []).map((i) => (i.id === row.id ? { ...i, isAvailable: row.isAvailable } : i)),
      );
      setError(`"${row.nameEn}" could not be updated. Please try again.`);
    }
  }

  const visible = (items ?? []).filter((i) =>
    search.trim()
      ? `${i.dishNumber ?? ''} ${i.nameEn} ${i.categoryName}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      : true,
  );
  const soldOutCount = (items ?? []).filter((i) => !i.isAvailable).length;

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <Link href="/waiter" className="inline-flex min-h-tap items-center text-sm text-ink-muted">
        ← Dashboard
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="h-section">Availability</h1>
        <span className="chip">{soldOutCount} sold out</span>
      </div>

      <input
        className="field"
        placeholder="Search dishes"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search dishes"
      />

      {error && (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}

      {!items && <p className="text-sm text-ink-muted">Loading…</p>}

      <ul className="space-y-2">
        {visible.map((row) => (
          <li key={row.id} className="card flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="font-medium">
                {row.dishNumber && <span className="text-ink-muted">{row.dishNumber} · </span>}
                {row.nameEn}
                {row.volume && <span className="text-ink-muted"> · {row.volume}</span>}
              </p>
              <p className="text-sm text-ink-muted">
                {row.categoryName} · {formatMoney(row.priceCents)}
              </p>
            </div>

            <button
              onClick={() => void toggle(row)}
              aria-pressed={!row.isAvailable}
              className={row.isAvailable ? 'btn-secondary px-4 py-2 text-sm' : 'btn-danger px-4 py-2 text-sm'}
            >
              {row.isAvailable ? 'Mark sold out' : 'Sold out — restore'}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
