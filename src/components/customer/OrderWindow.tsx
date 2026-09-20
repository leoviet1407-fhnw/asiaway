'use client';

import { useEffect, useRef, useState } from 'react';
import { useCustomer } from './CustomerProvider';

/**
 * The minute after a guest sends an order, in which it is still theirs.
 *
 * The countdown is the point of this component. A guest who is told "you can
 * still change it" without being shown how long has to guess, and guessing
 * wrong means calling a waiter over — the interruption this whole flow exists
 * to remove.
 *
 * The clock is the server's, not the browser's: `expiresAt` comes from the
 * order, so a phone with a wrong clock, or one that slept, still ends up with
 * the same answer as the kitchen.
 */
export function OrderWindow({
  orderId,
  orderNumber,
  expiresAt,
  onEdit,
  onClosed,
}: {
  orderId: string;
  orderNumber: number;
  expiresAt: string | null;
  onEdit: () => void;
  onClosed?: () => void;
}) {
  const { t } = useCustomer();
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(expiresAt));
  const [sending, setSending] = useState(false);
  const [closed, setClosed] = useState(() => remaining(expiresAt) <= 0);
  // The bar empties from wherever the guest joined. Someone who reopens the
  // page with twenty seconds left should see it drain from full, not sit at a
  // third full and vanish.
  const startedAt = useRef(Math.max(1, remaining(expiresAt)));

  useEffect(() => {
    if (closed) return;
    const tick = () => {
      const left = remaining(expiresAt);
      setSecondsLeft(left);
      if (left <= 0) {
        setClosed(true);
        onClosed?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, closed, onClosed]);

  async function sendNow() {
    if (sending || closed) return;
    setSending(true);
    try {
      await fetch(`/api/orders/${orderId}/send`, { method: 'POST' });
      setClosed(true);
      onClosed?.();
    } catch {
      // The countdown still runs. Nothing is lost: the order goes to the
      // kitchen on its own when the window closes.
    } finally {
      setSending(false);
    }
  }

  if (closed) {
    return (
      <div className="card space-y-1 p-4 text-left">
        <p className="font-semibold">{t('order.window.sentTitle')}</p>
        <p className="text-sm text-ink-muted">{t('order.window.closed')}</p>
      </div>
    );
  }

  const total = startedAt.current;

  return (
    <section
      className="card space-y-3 border-brand-500/40 p-4 text-left"
      aria-labelledby={`window-${orderId}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p id={`window-${orderId}`} className="font-semibold">
          {t('order.window.title')}
        </p>
        {/* Announced politely rather than assertively: a value changing every
            second must not interrupt a screen reader mid-sentence. */}
        <span className="chip bg-brand-50 tabular-nums text-brand-700" aria-live="polite">
          {t('order.window.countdown', { seconds: secondsLeft })}
        </span>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={secondsLeft}
        aria-label={t('order.window.title')}
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(100, Math.round((secondsLeft / total) * 100))}%` }}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-secondary flex-1" onClick={onEdit}>
          {t('order.window.change')}
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={sending}
          onClick={() => void sendNow()}
        >
          {sending ? t('order.window.sending') : t('order.window.send')}
        </button>
      </div>

      <p className="sr-only">{t('order.sent.number', { number: orderNumber })}</p>
    </section>
  );
}

/** Seconds left on the server's clock, never below zero. */
function remaining(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - Date.now()) / 1000));
}
