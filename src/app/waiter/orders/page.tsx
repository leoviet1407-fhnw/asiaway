'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatElapsed, formatMoney, formatTime } from '../../../lib/format';

interface QueueOrder {
  id: string;
  orderNumber: number;
  status: string;
  tableNumber: string;
  submittedAt: string;
  totalCents: number;
  itemCount: number;
  customerNote: string | null;
  items: { name: string; quantity: number }[];
}

export default function WaiterQueuePage() {
  const [orders, setOrders] = useState<QueueOrder[] | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/waiter/orders');
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) return;
    const data = await response.json();
    setOrders(data.orders);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <Link href="/waiter" className="inline-flex min-h-tap items-center text-sm text-ink-muted">
        ← Dashboard
      </Link>
      <h1 className="h-section">Orders waiting</h1>

      {!orders && <p className="text-sm text-ink-muted">Loading…</p>}
      {orders && orders.length === 0 && (
        <p className="card p-6 text-center text-sm text-ink-muted">No orders waiting.</p>
      )}

      <ul className="space-y-3">
        {(orders ?? []).map((order) => (
          <li key={order.id}>
            <Link href={`/waiter/orders/${order.id}`} className="card block p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-lg font-bold">#{order.orderNumber}</span>
                <span className="chip">Table {order.tableNumber}</span>
                {order.status === 'SUBMITTED' && (
                  <span className="chip bg-warn-50 text-warn-500">new</span>
                )}
              </div>

              <p className="mt-1 text-sm text-ink-muted">
                {formatTime(order.submittedAt)} · {formatElapsed(order.submittedAt)} ago ·{' '}
                {order.itemCount} items · {formatMoney(order.totalCents)}
              </p>

              <p className="mt-1 line-clamp-2 text-sm">
                {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
              </p>

              {order.customerNote && (
                <p className="mt-1 text-sm italic text-warn-500">“{order.customerNote}”</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
