'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCustomer } from '../../components/customer/CustomerProvider';
import { RESTAURANT } from '../../config/restaurant';
import { formatMoney, formatTime } from '../../lib/format';

/**
 * The bill, and calling staff to the table.
 *
 * Where guests pay at the table, asking for the bill is deliberately a two-step
 * action: a guest must not summon a waiter by brushing the screen. Pressing it
 * again after the request is harmless — the server returns the original moment
 * and creates no second alert.
 *
 * Where guests pay at the counter (Winterthur), there is no bill to ask for:
 * the page says where to pay and offers to call someone to the table instead.
 * A call stands until staff clear it, so pressing again alerts nobody twice.
 */
export default function CheckoutPage() {
  const { t } = useCustomer();
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [staffCalledAt, setStaffCalledAt] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [orderCount, setOrderCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((data) => {
        if (!data.active) return;
        setRequestedAt(data.checkoutRequestedAt);
        setStaffCalledAt(data.staffCalledAt ?? null);
        setTotal(data.sessionTotalCents);
        setOrderCount(data.orderCount);
      })
      .catch(() => setError(t('common.error')));
  }, [t]);

  useEffect(() => load(), [load]);

  // While staff are on their way, look again now and then: once a waiter has
  // cleared the call, the guest can call again without reloading.
  useEffect(() => {
    if (!staffCalledAt) return;
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [staffCalledAt, load]);

  async function post(path: string, onDone: (data: Record<string, string>) => void) {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(path, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setError(t('common.error'));
        return;
      }
      onDone(data);
    } catch {
      setError(t('common.offline'));
    } finally {
      setSending(false);
    }
  }

  const atCounter = RESTAURANT.payment === 'counter';

  const errorBox = error && (
    <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
      {error}
    </p>
  );

  const totalCard = total !== null && orderCount > 0 && (
    <div className="card flex justify-between p-4 text-lg font-semibold">
      <span>{t('orders.sessionTotal')}</span>
      <span>{formatMoney(total)}</span>
    </div>
  );

  const staffCall = RESTAURANT.guestCallsStaff && (
    <section className="card space-y-2 p-4" aria-live="polite">
      {staffCalledAt ? (
        <>
          <h2 className="font-semibold">{t('staffCall.called.title')}</h2>
          <p className="text-sm text-ink-muted">
            {t('staffCall.called.body', { time: formatTime(staffCalledAt) })}
          </p>
        </>
      ) : (
        <>
          <h2 className="font-semibold">{t('staffCall.title')}</h2>
          <p className="text-sm text-ink-muted">{t('staffCall.body')}</p>
          <button
            className={`${atCounter ? 'btn-primary' : 'btn-secondary'} w-full`}
            onClick={() => void post('/api/staff-call', (data) => setStaffCalledAt(data.calledAt!))}
            disabled={sending}
          >
            {sending ? t('cart.sending') : t('staffCall.confirm')}
          </button>
        </>
      )}
    </section>
  );

  if (atCounter) {
    return (
      <div className="space-y-4">
        <h1 className="h-section">{t('checkout.counter.title')}</h1>
        <p className="text-sm text-ink-muted">{t('checkout.counter.body')}</p>
        {totalCard}
        {errorBox}
        {staffCall}
      </div>
    );
  }

  if (requestedAt) {
    return (
      <div className="space-y-3 text-center">
        <div className="card space-y-2 p-6">
          <p className="text-3xl" aria-hidden="true">
            ✓
          </p>
          <h1 className="h-section">{t('checkout.requested.title')}</h1>
          <p className="text-sm text-ink-muted">
            {t('checkout.requested.body', { time: formatTime(requestedAt) })}
          </p>
        </div>
        {total !== null && (
          <div className="flex justify-between text-lg font-semibold">
            <span>{t('orders.sessionTotal')}</span>
            <span>{formatMoney(total)}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="h-section">{t('checkout.title')}</h1>
      <p className="text-sm text-ink-muted">{t('checkout.body')}</p>

      {totalCard}
      {errorBox}

      <button
        className="btn-primary w-full"
        onClick={() => void post('/api/checkout-request', (data) => setRequestedAt(data.requestedAt!))}
        disabled={sending}
      >
        {sending ? t('cart.sending') : t('checkout.confirm')}
      </button>

      {staffCall}
    </div>
  );
}
