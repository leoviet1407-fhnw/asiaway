'use client';

import { useEffect, useState } from 'react';
import { useCustomer } from '../../components/customer/CustomerProvider';
import { formatMoney, formatTime } from '../../lib/format';

/**
 * Asking for the bill.
 *
 * Deliberately a two-step action: a guest must not summon a waiter by brushing
 * the screen. Pressing it again after the request is harmless — the server
 * returns the original moment and creates no second alert.
 */
export default function CheckoutPage() {
  const { t } = useCustomer();
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [orderCount, setOrderCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((data) => {
        if (!data.active) return;
        setRequestedAt(data.checkoutRequestedAt);
        setTotal(data.sessionTotalCents);
        setOrderCount(data.orderCount);
      })
      .catch(() => setError(t('common.error')));
  }, [t]);

  async function request() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/checkout-request', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setError(t('common.error'));
        return;
      }
      setRequestedAt(data.requestedAt);
    } catch {
      setError(t('common.offline'));
    } finally {
      setSending(false);
    }
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

      {total !== null && orderCount > 0 && (
        <div className="card flex justify-between p-4 text-lg font-semibold">
          <span>{t('orders.sessionTotal')}</span>
          <span>{formatMoney(total)}</span>
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}

      <button className="btn-primary w-full" onClick={request} disabled={sending}>
        {sending ? t('cart.sending') : t('checkout.confirm')}
      </button>
    </div>
  );
}
