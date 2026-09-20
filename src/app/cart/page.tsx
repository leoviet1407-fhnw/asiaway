'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useCustomer } from '../../components/customer/CustomerProvider';
import { OrderWindow } from '../../components/customer/OrderWindow';
import { formatMoney, formatTime } from '../../lib/format';

interface SubmitResult {
  orderId: string;
  orderNumber: number;
  totalCents: number;
  submittedAt: string;
  customerWindowExpiresAt: string | null;
}

export default function CartPage() {
  const {
    t,
    cart,
    setQuantity,
    removeFromCart,
    clearCart,
    cartTotalCents,
    idempotencyKey,
    rotateIdempotencyKey,
    editingOrder,
    startEditingOrder,
    stopEditingOrder,
  } = useCustomer();
  const router = useRouter();

  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [soldOutNames, setSoldOutNames] = useState<string[]>([]);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [windowClosed, setWindowClosed] = useState(false);
  /**
   * What was in the cart at the moment of sending. The cart itself is cleared
   * on success, so without this "change my order" would open an empty cart.
   */
  const lastSubmitted = useRef<typeof cart>([]);

  /**
   * Saves a change to an order the guest has already sent.
   *
   * Separate from submit() on purpose: this must never create a second order.
   * If the window has closed in the meantime the server says so, and the guest
   * is told to ask staff rather than left thinking the change went through.
   */
  async function saveChanges() {
    if (sending || !editingOrder) return;
    setSending(true);
    setErrorMessage(null);
    setSoldOutNames([]);

    try {
      const response = await fetch(`/api/orders/${editingOrder.orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          note: note.trim() || null,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (data?.error?.code === 'ORDER_WINDOW_CLOSED') {
          setErrorMessage(t('order.window.closed'));
          stopEditingOrder();
        } else if (data?.error?.code === 'ITEMS_UNAVAILABLE') {
          const names: string[] = (data.error.details?.items ?? []).map(
            (i: { menuItemId: string; nameEn: string }) =>
              cart.find((l) => l.menuItemId === i.menuItemId)?.name ?? i.nameEn,
          );
          setSoldOutNames(names);
          for (const i of data.error.details?.items ?? []) removeFromCart(i.menuItemId);
        } else {
          setErrorMessage(t('common.error'));
        }
        return;
      }

      setSavedMessage(t('cart.editing.saved'));
      setResult({
        orderId: editingOrder.orderId,
        orderNumber: editingOrder.orderNumber,
        totalCents: data.totalCents,
        submittedAt: new Date().toISOString(),
        customerWindowExpiresAt: editingOrder.expiresAt,
      });
      stopEditingOrder();
    } catch {
      setErrorMessage(t('common.offline'));
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    // Guards the double tap in the UI; the server guards it for real with the
    // idempotency key, which is deliberately NOT rotated between retries.
    if (sending) return;
    setSending(true);
    setErrorMessage(null);
    setSoldOutNames([]);

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          items: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
          note: note.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data?.error?.code === 'ITEMS_UNAVAILABLE') {
          const names: string[] = (data.error.details?.items ?? []).map(
            (i: { menuItemId: string; nameEn: string }) =>
              cart.find((l) => l.menuItemId === i.menuItemId)?.name ?? i.nameEn,
          );
          setSoldOutNames(names);
          for (const i of data.error.details?.items ?? []) removeFromCart(i.menuItemId);
        } else if (data?.error?.code === 'SESSION_CLOSED' || data?.error?.code === 'SESSION_NOT_FOUND') {
          setErrorMessage(t('session.closed.body'));
        } else {
          setErrorMessage(t('common.error'));
        }
        return;
      }

      lastSubmitted.current = cart;
      setWindowClosed(false);
      setResult(data);
      clearCart();
      // A new key only after a confirmed success, so the NEXT order is a new one.
      rotateIdempotencyKey();
    } catch {
      setErrorMessage(t('common.offline'));
    } finally {
      setSending(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4 text-center">
        <div className="card space-y-2 p-6">
          <p className="text-3xl" aria-hidden="true">
            ✓
          </p>
          <h1 className="text-xl font-semibold">{t('order.sent.title')}</h1>
          <p className="text-lg font-semibold">
            {t('order.sent.number', { number: result.orderNumber })}
          </p>
          <p className="text-sm text-ink-muted">
            {t('order.sent.time', { time: formatTime(result.submittedAt) })}
          </p>
          <p className="text-sm text-ink-muted">{formatMoney(result.totalCents)}</p>
          {savedMessage && <p className="text-sm font-semibold text-brand-700">{savedMessage}</p>}
        </div>

        <OrderWindow
          orderId={result.orderId}
          orderNumber={result.orderNumber}
          expiresAt={result.customerWindowExpiresAt}
          onClosed={() => setWindowClosed(true)}
          onEdit={() => {
            // Put the order back in the cart exactly as sent, so "change" means
            // adjusting what they have rather than starting again.
            startEditingOrder(
              {
                orderId: result.orderId,
                orderNumber: result.orderNumber,
                expiresAt: result.customerWindowExpiresAt ?? new Date().toISOString(),
              },
              lastSubmitted.current,
            );
            setSavedMessage(null);
            setResult(null);
          }}
        />

        {/* Once the order has gone, this line would contradict the card above. */}
        {!windowClosed && <p className="text-sm text-ink-muted">{t('order.sent.body')}</p>}
        {/* Improvement 1: browsing on is the primary action; no waiting screen. */}
        <button className="btn-primary w-full" onClick={() => router.push('/menu')}>
          {t('order.sent.continue')}
        </button>
        <Link href="/orders" className="btn-secondary w-full">
          {t('orders.title')}
        </Link>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="h-section">{t('cart.title')}</h1>
        <p className="card p-4 text-sm text-ink-muted">{t('cart.empty')}</p>
        <Link href="/menu" className="btn-primary w-full">
          {t('cart.browse')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="h-section">
        {editingOrder ? t('cart.editing', { number: editingOrder.orderNumber }) : t('cart.title')}
      </h1>

      {editingOrder && (
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => {
            stopEditingOrder();
            router.push('/orders');
          }}
        >
          {t('cart.editing.cancel')}
        </button>
      )}

      {soldOutNames.length > 0 && (
        <p className="rounded-xl bg-warn-50 p-3 text-sm text-warn-500" role="alert">
          {t('cart.soldOutWarning')} {soldOutNames.join(', ')}
        </p>
      )}
      {errorMessage && (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
          {errorMessage}
        </p>
      )}

      <ul className="space-y-2">
        {cart.map((line) => (
          <li key={line.menuItemId} className="card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">
                  {line.dishNumber && <span className="text-ink-muted">{line.dishNumber} · </span>}
                  {line.name}
                </p>
                <p className="text-sm text-ink-muted">{formatMoney(line.unitPriceCents)}</p>
              </div>
              <p className="font-semibold">{formatMoney(line.unitPriceCents * line.quantity)}</p>
            </div>

            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                aria-label={`− ${line.name}`}
                className="btn-secondary min-w-tap px-3"
                onClick={() => setQuantity(line.menuItemId, line.quantity - 1)}
              >
                −
              </button>
              <span className="min-w-8 text-center font-semibold" aria-live="polite">
                {line.quantity}
              </span>
              <button
                type="button"
                aria-label={`+ ${line.name}`}
                className="btn-secondary min-w-tap px-3"
                onClick={() => setQuantity(line.menuItemId, line.quantity + 1)}
              >
                +
              </button>
              <button
                type="button"
                className="ml-auto min-h-tap px-2 text-sm text-danger-500"
                onClick={() => removeFromCart(line.menuItemId)}
              >
                {t('cart.remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Free text only. There are no restaurant-defined modifiers in Phase 1. */}
      <div className="card space-y-2 p-3">
        <label htmlFor="note" className="block text-sm font-semibold">
          {t('cart.note.label')}
        </label>
        <textarea
          id="note"
          className="field min-h-24"
          maxLength={500}
          placeholder={t('cart.note.placeholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-ink-muted">{t('cart.note.hint')}</p>
          <span className="shrink-0 text-xs text-ink-muted">
            {t('cart.note.counter', { count: note.length })}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between text-lg font-semibold">
        <span>{t('cart.total')}</span>
        <span>{formatMoney(cartTotalCents)}</span>
      </div>

      <div className="fixed inset-x-0 bottom-16 mx-auto max-w-md space-y-2 bg-surface-sunken/95 px-4 py-3 backdrop-blur">
        <button
          className="btn-primary w-full"
          onClick={editingOrder ? saveChanges : submit}
          disabled={sending}
        >
          {editingOrder
            ? sending
              ? t('cart.editing.saving')
              : `${t('cart.editing.save')} · ${formatMoney(cartTotalCents)}`
            : sending
              ? t('cart.sending')
              : `${t('cart.submit')} · ${formatMoney(cartTotalCents)}`}
        </button>
        <Link href="/menu" className="btn-secondary w-full">
          {t('cart.continue')}
        </Link>
      </div>
    </div>
  );
}
