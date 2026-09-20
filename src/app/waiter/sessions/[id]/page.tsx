'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime, formatElapsed, formatMoney } from '../../../../lib/format';

interface SessionOrder {
  id: string;
  orderNumber: number;
  status: string;
  submittedAt: string;
  confirmedAt: string | null;
  totalCents: number;
  currentRevisionNumber: number;
}

interface SessionDetail {
  session: {
    id: string;
    sessionNumber: number;
    status: 'OCCUPIED' | 'ORDER_PENDING' | 'CHECKOUT_REQUESTED' | 'CLOSED';
    openedAt: string;
    checkoutRequestedAt: string | null;
    closedAt: string | null;
  };
  table: { id: string; tableNumber: string; displayName: string } | null;
  orders: SessionOrder[];
  totalCents: number;
}

interface AuditEvent {
  id: number;
  occurredAt: string;
  actorType: string;
  action: string;
  beforeValue: unknown;
  afterValue: unknown;
  metadata: Record<string, unknown>;
}

/**
 * Table session view: every order in the session, the running total, and the
 * close action.
 *
 * Closing is the step that happens AFTER payment at the POS. It is confirmed
 * explicitly, and it refuses while orders are still waiting unless the waiter
 * forces it with a reason — which is written to the audit trail.
 */
export default function WaiterSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/waiter/sessions/${params.id}`);
    if (response.status === 401) {
      window.location.href = '/waiter/login';
      return;
    }
    if (!response.ok) {
      setError('This session could not be loaded.');
      return;
    }
    setDetail(await response.json());
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadAudit() {
    const response = await fetch(`/api/waiter/audit?sessionId=${params.id}`);
    if (response.ok) setAudit((await response.json()).events);
  }

  async function close(force: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/waiter/sessions/${params.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(force ? { force: true, reason: forceReason.trim() } : {}),
      });
      const data = await response.json();

      if (!response.ok) {
        if (data?.error?.code === 'SESSION_HAS_UNRESOLVED_ORDERS') {
          setError('Some orders are still waiting. Confirm them first, or close with a reason.');
        } else {
          setError(data?.error?.message ?? 'The session could not be closed.');
        }
        return;
      }

      router.push('/waiter');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-ink-muted">
        {error ?? 'Loading…'}
      </main>
    );
  }

  const pending = detail.orders.filter((o) => o.status === 'SUBMITTED' || o.status === 'EMPLOYEE_REVIEW');
  const isClosed = detail.session.status === 'CLOSED';

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <Link href="/waiter" className="inline-flex min-h-tap items-center text-sm text-ink-muted">
        ← Dashboard
      </Link>

      <header className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold">Table {detail.table?.tableNumber ?? '?'}</h1>
          <span className="chip">Session {detail.session.sessionNumber}</span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Opened {formatDateTime(detail.session.openedAt)} · {formatElapsed(detail.session.openedAt)} ago
        </p>
        {detail.session.checkoutRequestedAt && (
          <p className="mt-1 font-semibold text-danger-500">
            Bill requested {formatDateTime(detail.session.checkoutRequestedAt)}
          </p>
        )}
        {isClosed && detail.session.closedAt && (
          <p className="mt-1 text-sm text-ink-muted">
            Closed {formatDateTime(detail.session.closedAt)}
          </p>
        )}
      </header>

      <section className="card p-4">
        <h2 className="h-label mb-2">Orders in this session</h2>
        {detail.orders.length === 0 && <p className="text-sm text-ink-muted">No orders yet.</p>}
        <ul className="space-y-2">
          {detail.orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/waiter/orders/${order.id}`}
                className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-surface-sunken"
              >
                <span>
                  <span className="font-semibold">#{order.orderNumber}</span>{' '}
                  <span className="text-sm text-ink-muted">
                    {formatDateTime(order.submittedAt)}
                  </span>
                  {order.currentRevisionNumber > 0 && (
                    <span className="chip ml-2">rev {order.currentRevisionNumber}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={`chip ${
                      order.status === 'CONFIRMED'
                        ? 'bg-brand-50 text-brand-700'
                        : 'bg-warn-50 text-warn-500'
                    }`}
                  >
                    {order.status.replace('_', ' ').toLowerCase()}
                  </span>
                  <span className="font-semibold">{formatMoney(order.totalCents)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex justify-between border-t border-ink/10 pt-3 text-lg font-bold">
          <span>Session total</span>
          <span>{formatMoney(detail.totalCents)}</span>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Take payment at the POS, then close the session here.
        </p>

        {!isClosed && detail.table && (
          <Link
            href={`/waiter/order?tableId=${detail.table.id}`}
            className="btn-secondary mt-3 w-full"
          >
            Add another order for this table
          </Link>
        )}
      </section>

      {error && (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}

      {!isClosed && (
        <section className="card space-y-3 p-4">
          {!confirmingClose ? (
            <button className="btn-primary w-full" onClick={() => setConfirmingClose(true)}>
              Payment taken — close session
            </button>
          ) : (
            <>
              <p className="text-sm">
                Confirm that payment of <strong>{formatMoney(detail.totalCents)}</strong> has been
                taken at the POS for table {detail.table?.tableNumber}.
              </p>

              {pending.length > 0 && (
                <div className="space-y-2 rounded-xl bg-warn-50 p-3">
                  <p className="text-sm text-warn-500">
                    {pending.length} order(s) have not been confirmed yet. Closing anyway needs a
                    reason, which is recorded.
                  </p>
                  <input
                    className="field"
                    placeholder="Reason"
                    value={forceReason}
                    onChange={(e) => setForceReason(e.target.value)}
                    maxLength={200}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button className="btn-secondary flex-1" onClick={() => setConfirmingClose(false)}>
                  Cancel
                </button>
                <button
                  className="btn-primary flex-1"
                  disabled={busy || (pending.length > 0 && forceReason.trim().length === 0)}
                  onClick={() => void close(pending.length > 0)}
                >
                  Close session
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card p-4">
        <button
          className="text-sm font-semibold text-brand-700"
          onClick={() => {
            setShowAudit((s) => !s);
            if (!audit) void loadAudit();
          }}
          aria-expanded={showAudit}
        >
          {showAudit ? 'Hide' : 'Show'} history
        </button>

        {showAudit && (
          <ol className="mt-3 space-y-2 text-sm">
            {(audit ?? []).map((event) => (
              <li key={event.id} className="border-b border-ink/5 pb-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{event.action.replaceAll('_', ' ').toLowerCase()}</span>
                  <span className="text-ink-muted">{formatDateTime(event.occurredAt)}</span>
                </div>
                <p className="text-ink-muted">
                  {event.actorType.toLowerCase()}
                  {typeof event.metadata?.label === 'string' && ` · ${event.metadata.label}`}
                  {event.beforeValue !== null &&
                    event.afterValue !== null &&
                    ['number', 'string'].includes(typeof event.beforeValue) &&
                    ` · ${String(event.beforeValue)} → ${String(event.afterValue)}`}
                </p>
              </li>
            ))}
            {audit?.length === 0 && <li className="text-ink-muted">No events.</li>}
          </ol>
        )}
      </section>
    </main>
  );
}
