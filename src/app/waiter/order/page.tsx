'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { DishSearch, type SearchableDish } from '../../../components/waiter/DishSearch';
import { formatMoney } from '../../../lib/format';

interface TableRow {
  tableId: string;
  tableNumber: string;
  area: 'INSIDE' | 'OUTSIDE' | null;
  state: string;
  sessionTotalCents: number;
  orderCount: number;
}

interface Line {
  menuItemId: string;
  dishNumber: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function OrderPad() {
  const router = useRouter();
  const params = useSearchParams();

  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [dishes, setDishes] = useState<SearchableDish[]>([]);
  const [tableId, setTableId] = useState<string>(params.get('tableId') ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderNumber: number; totalCents: number } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);

  useEffect(() => {
    void fetch('/api/waiter/dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setTables(d.tables))
      .catch(() => undefined);

    void fetch('/api/waiter/menu-items')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDishes(d.items))
      .catch(() => undefined);
  }, []);

  const total = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const table = tables?.find((t) => t.tableId === tableId);

  const add = useCallback((dish: SearchableDish) => {
    setLines((current) => {
      const existing = current.find((l) => l.menuItemId === dish.id);
      if (existing) {
        return current.map((l) =>
          l.menuItemId === dish.id ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l,
        );
      }
      return [
        ...current,
        {
          menuItemId: dish.id,
          dishNumber: dish.dishNumber,
          name: dish.nameEn,
          unitPriceCents: dish.priceCents,
          quantity: 1,
        },
      ];
    });
  }, []);

  const setQuantity = (menuItemId: string, quantity: number) =>
    setLines((current) =>
      quantity <= 0
        ? current.filter((l) => l.menuItemId !== menuItemId)
        : current.map((l) =>
            l.menuItemId === menuItemId ? { ...l, quantity: Math.min(99, quantity) } : l,
          ),
    );

  async function submit() {
    if (busy || !tableId || lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/waiter/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          tableId,
          items: lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          note: note.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error?.message ?? 'The order could not be saved.');
        return;
      }
      setDone({ orderNumber: data.orderNumber, totalCents: data.totalCents });
      setLines([]);
      setNote('');
      // Only after a confirmed success, so the NEXT order is a new one.
      setIdempotencyKey(newKey());
    } catch {
      setError('No connection. The order was not saved.');
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const order: TableRow['area'][] = ['INSIDE', 'OUTSIDE', null];
    return order
      .map((area) => [area, (tables ?? []).filter((t) => t.area === area)] as const)
      .filter(([, group]) => group.length > 0);
  }, [tables]);

  if (done) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 text-center">
        <div className="card space-y-2 p-6">
          <p className="text-3xl" aria-hidden="true">
            ✓
          </p>
          <h1 className="text-xl font-semibold">Order #{done.orderNumber} confirmed</h1>
          <p className="text-ink-muted">
            Table {table?.tableNumber} · {formatMoney(done.totalCents)}
          </p>
          <p className="pt-2 text-sm text-ink-muted">Now enter it into the POS.</p>
        </div>
        <button className="btn-primary w-full" onClick={() => setDone(null)}>
          Take another order for this table
        </button>
        <Link href="/waiter" className="btn-secondary w-full">
          Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-4 pb-40">
      <Link href="/waiter" className="inline-flex min-h-tap items-center text-sm text-ink-muted">
        ← Dashboard
      </Link>

      <h1 className="h-section">Take an order</h1>
      <p className="-mt-2 text-sm text-ink-muted">
        For guests ordering at the table rather than from their own phone.
      </p>

      <section className="card p-4">
        <h2 className="mb-2 h-label">Table</h2>
        {!tables && <p className="text-sm text-ink-muted">Loading…</p>}
        {grouped.map(([area, group]) => (
          <div key={area ?? 'none'} className="mb-3">
            <p className="mb-1 text-xs uppercase tracking-wide text-ink-muted">
              {area === 'OUTSIDE' ? 'Outside' : area === 'INSIDE' ? 'Inside' : 'Tables'}
            </p>
            <div className="flex flex-wrap gap-2">
              {group.map((t) => (
                <button
                  key={t.tableId}
                  type="button"
                  aria-pressed={t.tableId === tableId}
                  onClick={() => setTableId(t.tableId)}
                  className={`min-h-tap min-w-tap rounded-xl border px-4 text-base font-semibold ${
                    t.tableId === tableId
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : t.orderCount > 0
                        ? 'border-brand-500/40 bg-brand-50 text-ink'
                        : 'border-ink/15 bg-surface text-ink'
                  }`}
                >
                  {t.tableNumber}
                </button>
              ))}
            </div>
          </div>
        ))}
        {table && table.orderCount > 0 && (
          <p className="text-sm text-ink-muted">
            This table already has {table.orderCount} order(s), {formatMoney(table.sessionTotalCents)}.
            This one is added to the same session.
          </p>
        )}
      </section>

      <section className="card p-4">
        <DishSearch dishes={dishes} onPick={add} />
        <p className="mt-2 text-xs text-ink-muted">
          Type a dish number straight off the menu, or part of a name in any of the three languages.
          Arrow keys and Enter work.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 h-label">Order</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing added yet.</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((line) => (
              <li key={line.menuItemId} className="flex items-center gap-3 border-b border-ink/5 pb-2">
                <span className="min-w-0 flex-1">
                  {line.dishNumber && <span className="text-ink-muted">{line.dishNumber} · </span>}
                  {line.name}
                </span>
                <button
                  className="btn-secondary min-w-tap px-3"
                  aria-label={`Fewer ${line.name}`}
                  onClick={() => setQuantity(line.menuItemId, line.quantity - 1)}
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold">{line.quantity}</span>
                <button
                  className="btn-secondary min-w-tap px-3"
                  aria-label={`More ${line.name}`}
                  onClick={() => setQuantity(line.menuItemId, line.quantity + 1)}
                >
                  +
                </button>
                <span className="w-24 text-right font-semibold">
                  {formatMoney(line.unitPriceCents * line.quantity)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="note" className="mt-4 block h-label">
          Special request
        </label>
        <input
          id="note"
          className="field mt-1"
          maxLength={500}
          placeholder="e.g. no coriander"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="mt-3 flex justify-between text-lg font-bold">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>
      </section>

      {error && (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-3xl border-t border-ink/10 bg-surface p-4">
        <button
          className="btn-primary w-full"
          disabled={busy || !tableId || lines.length === 0}
          onClick={() => void submit()}
        >
          {busy
            ? 'Saving…'
            : !tableId
              ? 'Choose a table first'
              : lines.length === 0
                ? 'Add a dish first'
                : `Confirm order for table ${table?.tableNumber} · ${formatMoney(total)}`}
        </button>
      </div>
    </main>
  );
}

export default function WaiterOrderPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-ink-muted">Loading…</main>}>
      <OrderPad />
    </Suspense>
  );
}
