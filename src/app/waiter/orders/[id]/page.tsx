'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime, formatMoney } from '../../../../lib/format';

interface OrderLine {
  menuItemId: string | null;
  dishNumber: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  allergenCodes: string[];
}

interface Snapshot {
  items: { nameEn: string; quantity: number; lineTotalCents: number }[];
  customerNote: string | null;
  totalCents: number;
}

interface OrderDetail {
  id: string;
  orderNumber: number;
  status: 'SUBMITTED' | 'EMPLOYEE_REVIEW' | 'CONFIRMED' | 'CANCELLED';
  currentRevisionNumber: number;
  tableNumber: string;
  sessionId: string;
  submittedAt: string;
  confirmedAt: string | null;
  totalCents: number;
  customerNote: string | null;
  waiterNote: string | null;
  items: OrderLine[];
  originalSubmission: Snapshot | null;
  revisions: {
    revisionNumber: number;
    revisionType: string;
    createdAt: string;
    reason: string | null;
    totalCentsAfter: number;
  }[];
}

interface MenuOption {
  id: string;
  dishNumber: string | null;
  nameEn: string;
  priceCents: number;
  isAvailable: boolean;
}

/**
 * Order review and edit.
 *
 * The guest's original submission is always on screen next to the working copy,
 * so the waiter can see exactly what was asked for before changing anything.
 * Saving creates a revision; it never overwrites that original.
 */
export default function WaiterOrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lines, setLines] = useState<{ menuItemId: string; name: string; quantity: number; unitPriceCents: number }[]>([]);
  const [waiterNote, setWaiterNote] = useState('');
  const [reason, setReason] = useState('');
  const [menu, setMenu] = useState<MenuOption[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/waiter/orders/${params.id}`);
    if (!response.ok) {
      setError('This order could not be loaded.');
      return;
    }
    const data: OrderDetail = await response.json();
    setOrder(data);
    setLines(
      data.items
        .filter((i): i is OrderLine & { menuItemId: string } => i.menuItemId !== null)
        .map((i) => ({
          menuItemId: i.menuItemId,
          name: i.name,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
        })),
    );
    setWaiterNote(data.waiterNote ?? '');
  }, [params.id]);

  useEffect(() => {
    void load();
    // Opening the order marks it as under review — this is the "waiter picked it
    // up" moment the audit trail records.
    void fetch(`/api/waiter/orders/${params.id}/open`, { method: 'POST' });
    void fetch('/api/waiter/menu-items')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setMenu(data.items))
      .catch(() => undefined);
  }, [load, params.id]);

  const total = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const dirty =
    order !== null &&
    (JSON.stringify(lines.map((l) => [l.menuItemId, l.quantity]).sort()) !==
      JSON.stringify(
        order.items
          .filter((i) => i.menuItemId)
          .map((i) => [i.menuItemId, i.quantity])
          .sort(),
      ) ||
      waiterNote !== (order.waiterNote ?? ''));

  async function save(): Promise<boolean> {
    if (!order || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/waiter/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          waiterNote: waiterNote.trim() || null,
          reason: reason.trim() || null,
          expectedRevisionNumber: order.currentRevisionNumber,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(
          data?.error?.code === 'REVISION_CONFLICT'
            ? 'Another device changed this order. Reloading the latest version.'
            : (data?.error?.message ?? 'The change could not be saved.'),
        );
        if (data?.error?.code === 'REVISION_CONFLICT') await load();
        return false;
      }

      setReason('');
      await load();
      return true;
    } catch {
      setError('No connection. The change was not saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!order || busy) return;
    if (dirty && !(await save())) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/waiter/orders/${order.id}/confirm`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json();
        setError(data?.error?.message ?? 'The order could not be confirmed.');
        return;
      }
      router.push('/waiter/orders');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (error && !order) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <p className="card p-4 text-sm">{error}</p>
        <Link href="/waiter/orders" className="btn-secondary mt-3">
          Back to queue
        </Link>
      </main>
    );
  }

  if (!order) {
    return <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-ink-muted">Loading…</main>;
  }

  const matches = search.trim()
    ? menu.filter((m) =>
        `${m.dishNumber ?? ''} ${m.nameEn}`.toLowerCase().includes(search.trim().toLowerCase()),
      ).slice(0, 8)
    : [];

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-4 pb-40">
      <Link href="/waiter/orders" className="inline-flex min-h-tap items-center text-sm text-ink-muted">
        ← Queue
      </Link>

      <header className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold">#{order.orderNumber}</h1>
          <span className="chip">Table {order.tableNumber}</span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Submitted {formatDateTime(order.submittedAt)} · {order.status.replace('_', ' ').toLowerCase()}
        </p>
        {order.confirmedAt && (
          <p className="text-sm text-brand-700">Confirmed {formatDateTime(order.confirmedAt)}</p>
        )}
      </header>

      {/* The guest's free-text request, given its own prominent block: it is the
          single easiest thing to miss and the most annoying to get wrong. */}
      {order.customerNote && (
        <section className="card border-warn-500/50 bg-warn-50 p-4">
          <h2 className="h-label">Special request from the guest</h2>
          <p className="mt-1 text-lg">“{order.customerNote}”</p>
        </section>
      )}

      {error && (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}

      <section className="card p-4">
        <h2 className="h-label mb-2">Items</h2>
        <ul className="space-y-2">
          {lines.map((line) => (
            <li key={line.menuItemId} className="flex items-center gap-3 border-b border-ink/5 pb-2">
              <span className="min-w-0 flex-1">{line.name}</span>
              <button
                className="btn-secondary min-w-tap px-3"
                aria-label={`Fewer ${line.name}`}
                disabled={order.status === 'CONFIRMED'}
                onClick={() =>
                  setLines((current) =>
                    current
                      .map((l) =>
                        l.menuItemId === line.menuItemId ? { ...l, quantity: l.quantity - 1 } : l,
                      )
                      .filter((l) => l.quantity > 0),
                  )
                }
              >
                −
              </button>
              <span className="w-8 text-center font-semibold">{line.quantity}</span>
              <button
                className="btn-secondary min-w-tap px-3"
                aria-label={`More ${line.name}`}
                disabled={order.status === 'CONFIRMED'}
                onClick={() =>
                  setLines((current) =>
                    current.map((l) =>
                      l.menuItemId === line.menuItemId
                        ? { ...l, quantity: Math.min(99, l.quantity + 1) }
                        : l,
                    ),
                  )
                }
              >
                +
              </button>
              <span className="w-24 text-right font-semibold">
                {formatMoney(line.unitPriceCents * line.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex justify-between text-lg font-bold">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>
      </section>

      {order.status !== 'CONFIRMED' && (
        <section className="card space-y-2 p-4">
          <label htmlFor="add" className="text-sm font-semibold">
            Add an item
          </label>
          <input
            id="add"
            className="field"
            placeholder="Search by number or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {matches.length > 0 && (
            <ul className="space-y-1">
              {matches.map((option) => (
                <li key={option.id}>
                  <button
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-surface-sunken"
                    onClick={() => {
                      setLines((current) => {
                        const existing = current.find((l) => l.menuItemId === option.id);
                        return existing
                          ? current.map((l) =>
                              l.menuItemId === option.id ? { ...l, quantity: l.quantity + 1 } : l,
                            )
                          : [
                              ...current,
                              {
                                menuItemId: option.id,
                                name: option.nameEn,
                                quantity: 1,
                                unitPriceCents: option.priceCents,
                              },
                            ];
                      });
                      setSearch('');
                    }}
                  >
                    <span>
                      {option.dishNumber && (
                        <span className="text-ink-muted">{option.dishNumber} · </span>
                      )}
                      {option.nameEn}
                      {!option.isAvailable && (
                        <span className="chip ml-2 bg-danger-50 text-danger-500">sold out</span>
                      )}
                    </span>
                    <span className="font-semibold">{formatMoney(option.priceCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label htmlFor="waiterNote" className="pt-2 text-sm font-semibold">
            Staff note
          </label>
          <input
            id="waiterNote"
            className="field"
            value={waiterNote}
            onChange={(e) => setWaiterNote(e.target.value)}
            maxLength={500}
          />

          <label htmlFor="reason" className="pt-2 text-sm font-semibold">
            Reason for the change (recorded in the history)
          </label>
          <input
            id="reason"
            className="field"
            placeholder="e.g. guest changed their mind"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
          />
        </section>
      )}

      {order.originalSubmission && order.currentRevisionNumber > 0 && (
        <section className="card p-4">
          <h2 className="h-label">What the guest originally sent</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            {order.originalSubmission.items.map((item, index) => (
              <li key={index} className="flex justify-between">
                <span>
                  {item.quantity} × {item.nameEn}
                </span>
                <span>{formatMoney(item.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm font-semibold">
            {formatMoney(order.originalSubmission.totalCents)}
          </p>
        </section>
      )}

      <section className="card p-4">
        <button
          className="block text-sm font-semibold text-brand-700"
          onClick={() => setShowHistory((s) => !s)}
          aria-expanded={showHistory}
        >
          {showHistory ? 'Hide' : 'Show'} change history ({order.revisions.length})
        </button>
        {showHistory && (
          <ol className="mt-2 space-y-1 text-sm text-ink-muted">
            {order.revisions.map((rev) => (
              <li key={rev.revisionNumber} className="flex justify-between gap-3">
                <span>
                  #{rev.revisionNumber} {rev.revisionType.replaceAll('_', ' ').toLowerCase()}
                  {rev.reason && ` — ${rev.reason}`}
                </span>
                <span className="shrink-0">
                  {formatDateTime(rev.createdAt)} · {formatMoney(rev.totalCentsAfter)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <Link
          href={`/waiter/sessions/${order.sessionId}`}
          className="mt-3 block text-sm text-brand-700"
        >
          View the whole table session →
        </Link>
      </section>

      {order.status !== 'CONFIRMED' && (
        <div className="fixed inset-x-0 bottom-0 mx-auto flex max-w-3xl gap-3 border-t border-ink/10 bg-surface p-4">
          <button className="btn-secondary flex-1" onClick={() => void save()} disabled={busy || !dirty}>
            Save changes
          </button>
          <button className="btn-primary flex-[2]" onClick={() => void confirm()} disabled={busy}>
            Confirm order · {formatMoney(total)}
          </button>
        </div>
      )}
    </main>
  );
}
