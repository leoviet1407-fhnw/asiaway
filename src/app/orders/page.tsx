'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCustomer } from '../../components/customer/CustomerProvider';
import { OrderWindow } from '../../components/customer/OrderWindow';
import { formatMoney, formatTime } from '../../lib/format';

interface OrderLine {
  name: { en: string; de: string; vi: string };
  menuItemId: string;
  dishNumber: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

interface CustomerOrder {
  id: string;
  state: 'EDITABLE' | 'RECEIVED' | 'CONFIRMED' | 'CANCELLED';
  customerWindowExpiresAt: string | null;
  orderNumber: number;
  submittedAt: string;
  totalCents: number;
  wasAdjustedByStaff: boolean;
  note: string | null;
  items: OrderLine[];
}

/**
 * The guest's own orders, read-only.
 *
 * Shows the CURRENT version and flags where staff adjusted it — that is what
 * "the customer can see the final order if the waiter changes it" asks for.
 * There is no live status here by design.
 */
export default function OrdersPage() {
  const { t, locale, startEditingOrder } = useCustomer();
  const router = useRouter();
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetch('/api/orders')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('orders'))))
      .then((data) => {
        setOrders(data.orders);
        setTotal(data.sessionTotalCents);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <p className="card p-4 text-sm">{t('common.error')}</p>;
  }

  if (!orders) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t('common.loading')}</span>
        <div className="card h-24 animate-pulse bg-surface-sunken" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="h-section">{t('orders.title')}</h1>
        <p className="card p-4 text-sm text-ink-muted">{t('orders.empty')}</p>
        <Link href="/menu" className="btn-primary w-full">
          {t('cart.browse')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="h-section">{t('orders.title')}</h1>

      {orders.map((order) => (
        <section key={order.orderNumber} className="card space-y-2 p-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">
              {t('order.sent.number', { number: order.orderNumber })}
            </h2>
            <span className="text-sm text-ink-muted">{formatTime(order.submittedAt)}</span>
          </div>

          {order.wasAdjustedByStaff && (
            <p className="chip bg-warn-50 text-warn-500">{t('orders.adjusted')}</p>
          )}

          <ul className="space-y-1 text-sm">
            {order.items.map((item, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span>
                  {item.quantity} × {item.name[locale]}
                </span>
                <span className="shrink-0 text-ink-muted">{formatMoney(item.lineTotalCents)}</span>
              </li>
            ))}
          </ul>

          {order.note && <p className="text-sm italic text-ink-muted">“{order.note}”</p>}

          <div className="flex justify-between border-t border-ink/10 pt-2 font-semibold">
            <span>{t('cart.total')}</span>
            <span>{formatMoney(order.totalCents)}</span>
          </div>

          {/* Still the guest's to change — reachable from here too, because a
              guest who browsed on after ordering has left the cart screen
              behind and this is where they come looking. */}
          {order.state === 'EDITABLE' && (
            <OrderWindow
              orderId={order.id}
              orderNumber={order.orderNumber}
              expiresAt={order.customerWindowExpiresAt}
              onClosed={load}
              onEdit={() => {
                startEditingOrder(
                  {
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    expiresAt: order.customerWindowExpiresAt ?? new Date().toISOString(),
                  },
                  order.items.map((item) => ({
                    menuItemId: item.menuItemId,
                    name: item.name[locale],
                    dishNumber: item.dishNumber,
                    unitPriceCents: item.unitPriceCents,
                    quantity: item.quantity,
                  })),
                );
                router.push('/cart');
              }}
            />
          )}
        </section>
      ))}

      <div className="flex justify-between text-lg font-semibold">
        <span>{t('orders.sessionTotal')}</span>
        <span>{formatMoney(total)}</span>
      </div>
    </div>
  );
}
