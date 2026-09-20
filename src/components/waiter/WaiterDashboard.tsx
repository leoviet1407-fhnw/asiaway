'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useWaiterEvents } from './useWaiterEvents';
import { formatElapsed, formatMoney, formatTime } from '../../lib/format';

interface TableTile {
  tableId: string;
  tableNumber: string;
  displayName: string;
  state: 'AVAILABLE' | 'OCCUPIED' | 'ORDER_PENDING' | 'CHECKOUT_REQUESTED';
  sessionId: string | null;
  openedAt: string | null;
  checkoutRequestedAt: string | null;
  pendingOrders: number;
  orderCount: number;
  sessionTotalCents: number;
}

const STATE_STYLE: Record<TableTile['state'], string> = {
  AVAILABLE: 'border-ink/10 bg-surface',
  OCCUPIED: 'border-brand-500/40 bg-brand-50',
  ORDER_PENDING: 'border-warn-500/50 bg-warn-50',
  CHECKOUT_REQUESTED: 'border-danger-500/50 bg-danger-50',
};

const STATE_LABEL: Record<TableTile['state'], string> = {
  AVAILABLE: 'Free',
  OCCUPIED: 'Seated',
  ORDER_PENDING: 'Order waiting',
  CHECKOUT_REQUESTED: 'Bill requested',
};

export function WaiterDashboard({ userName }: { userName: string }) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const { notifications, connection, newOrderCount, checkoutCount, refresh } =
    useWaiterEvents(soundEnabled);
  const [tables, setTables] = useState<TableTile[] | null>(null);

  const loadTables = useCallback(async () => {
    try {
      const response = await fetch('/api/waiter/dashboard');
      if (!response.ok) return;
      const data = await response.json();
      setTables(data.tables);
    } catch {
      // Keep the last known grid on screen rather than blanking it.
    }
  }, []);

  useEffect(() => {
    void loadTables();
  }, [loadTables, notifications.length]);

  useEffect(() => {
    const id = setInterval(() => void loadTables(), 30_000);
    return () => clearInterval(id);
  }, [loadTables]);

  // Keeps an always-on tablet from sleeping mid-service.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        // Unsupported or denied: not important enough to surface.
      }
    };
    void request();
    return () => {
      void lock?.release().catch(() => undefined);
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Asiaway — service</h1>
          <p className="text-sm text-ink-muted">Signed in as {userName}</p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`chip ${
              connection === 'live'
                ? 'bg-brand-50 text-brand-700'
                : connection === 'degraded'
                  ? 'bg-warn-50 text-warn-500'
                  : 'bg-surface-sunken'
            }`}
            title={
              connection === 'degraded'
                ? 'Live updates unavailable — checking every 10 seconds'
                : undefined
            }
          >
            {connection === 'live' ? 'Live' : connection === 'degraded' ? 'Delayed' : 'Connecting…'}
          </span>

          <button
            className="btn-secondary px-3 py-2 text-sm"
            onClick={() => setSoundEnabled((s) => !s)}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? 'Sound on' : 'Sound off'}
          </button>

          <Link href="/waiter/menu" className="btn-secondary px-3 py-2 text-sm">
            Sold out
          </Link>

          <form action="/api/waiter/auth/signout" method="post">
            <button
              className="btn-secondary px-3 py-2 text-sm"
              onClick={async (e) => {
                e.preventDefault();
                await fetch('/api/waiter/auth/signout', { method: 'POST' });
                window.location.href = '/waiter/login';
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Link href="/waiter/orders" className="card p-4">
          <p className="text-sm text-ink-muted">New orders</p>
          <p className={`text-3xl font-bold ${newOrderCount > 0 ? 'text-warn-500' : ''}`}>
            {newOrderCount}
          </p>
        </Link>
        <div className="card p-4">
          <p className="text-sm text-ink-muted">Bill requests</p>
          <p className={`text-3xl font-bold ${checkoutCount > 0 ? 'text-danger-500' : ''}`}>
            {checkoutCount}
          </p>
        </div>
      </div>

      {/* The alert banner stays until the order is opened or acknowledged —
          never dismissed by a timer. */}
      {notifications.length > 0 && (
        <section className="mb-4 space-y-2" aria-live="polite">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`card flex flex-wrap items-center justify-between gap-3 p-3 ${
                n.type === 'CHECKOUT_REQUESTED' ? 'border-danger-500/50' : 'border-warn-500/50'
              }`}
            >
              <div>
                <p className="font-semibold">
                  {n.type === 'CHECKOUT_REQUESTED' ? 'Bill requested' : 'New order'} — Table{' '}
                  {n.tableNumber ?? '?'}
                  {typeof n.payload?.orderNumber === 'number' && ` · #${n.payload.orderNumber}`}
                </p>
                <p className="text-sm text-ink-muted">
                  {formatTime(n.createdAt)} · {formatElapsed(n.createdAt)} ago
                  {typeof n.payload?.totalCents === 'number' &&
                    ` · ${formatMoney(n.payload.totalCents as number)}`}
                </p>
              </div>
              <Link
                href={
                  n.orderId
                    ? `/waiter/orders/${n.orderId}`
                    : n.sessionId
                      ? `/waiter/sessions/${n.sessionId}`
                      : '/waiter/orders'
                }
                className="btn-primary px-4 py-2 text-sm"
              >
                Open
              </Link>
            </div>
          ))}
        </section>
      )}

      <h2 className="mb-2 text-base font-semibold">Tables</h2>

      {!tables && <p className="text-sm text-ink-muted">Loading…</p>}
      {tables && tables.length === 0 && (
        <p className="card p-4 text-sm text-ink-muted">
          No tables configured yet. Run the seed script to add demo tables.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {(tables ?? []).map((table) => {
          const inner = (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-bold">{table.tableNumber}</span>
                <span className="chip">{STATE_LABEL[table.state]}</span>
              </div>
              {table.sessionId ? (
                <div className="mt-2 space-y-0.5 text-sm text-ink-muted">
                  <p>{table.orderCount} orders · {formatMoney(table.sessionTotalCents)}</p>
                  {table.openedAt && <p>Seated {formatElapsed(table.openedAt)}</p>}
                  {table.pendingOrders > 0 && (
                    <p className="font-semibold text-warn-500">
                      {table.pendingOrders} waiting
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">Available</p>
              )}
            </>
          );

          return table.sessionId ? (
            <Link
              key={table.tableId}
              href={`/waiter/sessions/${table.sessionId}`}
              className={`card border p-3 ${STATE_STYLE[table.state]}`}
            >
              {inner}
            </Link>
          ) : (
            <div key={table.tableId} className={`card border p-3 ${STATE_STYLE[table.state]}`}>
              {inner}
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <button className="btn-secondary text-sm" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
    </div>
  );
}
