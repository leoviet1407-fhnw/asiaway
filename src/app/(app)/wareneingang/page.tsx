import { formatDay, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listReceivable } from '@/server/services/receiving-service';
import { OrderStatusChip } from '@/components/StatusChip';
import { startReceiptAction } from '../../actions';

export const metadata = { title: 'Wareneingang' };

export default async function ReceivingListPage() {
  const p = await requirePrincipal();
  const orders = await listReceivable(await db(), p);
  const today = todayIso();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl">Wareneingang</h1>
      <p className="text-charcoal-muted">Lieferung antippen, dann Ware scannen oder abhaken.</p>
      {orders.length === 0 ? (
        <p className="card text-charcoal-muted">Keine gesendeten Bestellungen offen.</p>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.id}>
              <form action={startReceiptAction}>
                <input type="hidden" name="orderId" value={o.id} />
                <button className="card flex w-full items-center justify-between gap-3 text-left hover:border-brand-600">
                  <div className="min-w-0">
                    <div className="font-semibold text-navy">{o.supplierName}</div>
                    <div className="text-sm text-charcoal-muted">
                      {o.locationName} · {o.number}
                    </div>
                    <div className={`text-sm ${o.deliveryDate && o.deliveryDate <= today ? 'font-semibold text-brand-600' : 'text-charcoal-muted'}`}>
                      Lieferung {formatDay(o.deliveryDate)}
                      {o.deliveryDate === today && ' (heute)'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <OrderStatusChip status={o.status} />
                    <span className="text-sm font-semibold text-brand-600">{o.openReceiptId ? 'Fortsetzen →' : 'Starten →'}</span>
                  </div>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
