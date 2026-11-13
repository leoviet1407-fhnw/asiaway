import Link from 'next/link';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/domain/order';
import { formatChf } from '@/domain/qty';
import { locationsFor } from '@/domain/roles';
import { formatDay } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listOrderLocations } from '@/server/services/catalog-service';
import { listOrders } from '@/server/services/order-service';
import { OrderStatusChip } from '@/components/StatusChip';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Bestellungen') };
}

const FILTERS: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: 'offen', label: 'Offen', statuses: ['DRAFT', 'SUBMITTED', 'SENT', 'PARTIALLY_RECEIVED'] },
  { key: 'entwurf', label: ORDER_STATUS_LABEL.DRAFT, statuses: ['DRAFT'] },
  { key: 'pruefung', label: ORDER_STATUS_LABEL.SUBMITTED, statuses: ['SUBMITTED'] },
  { key: 'gesendet', label: ORDER_STATUS_LABEL.SENT, statuses: ['SENT', 'PARTIALLY_RECEIVED'] },
  { key: 'archiv', label: 'Archiv', statuses: ['RECEIVED', 'CANCELLED'] },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; ort?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  const params = await searchParams;
  const database = await db();
  const filter = FILTERS.find((f) => f.key === params.status) ?? FILTERS[0]!;
  const locs = locationsFor(p, await listOrderLocations(database));
  const locationId = locs.some((l) => l.id === params.ort) ? params.ort : undefined;
  const orders = await listOrders(database, p, { statuses: filter.statuses, locationId });
  const href = (status: string, ort?: string) => `/bestellungen?status=${status}${ort ? `&ort=${ort}` : ''}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl">{t('Bestellungen')}</h1>
        <Link href="/bestellungen/neu" className="btn-primary">
          {t('+ Neue Bestellung')}
        </Link>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <Link key={f.key} href={href(f.key, locationId)} className={`chip whitespace-nowrap px-3 py-1.5 text-sm ${f.key === filter.key ? 'bg-navy text-white' : 'bg-white text-navy ring-1 ring-surface-line'}`}>
            {t(f.label)}
          </Link>
        ))}
      </div>
      {locs.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          <Link href={href(filter.key)} className={`chip whitespace-nowrap px-3 py-1 ${!locationId ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>
            {t('Alle Standorte')}
          </Link>
          {locs.map((l) => (
            <Link key={l.id} href={href(filter.key, l.id)} className={`chip whitespace-nowrap px-3 py-1 ${locationId === l.id ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>
              {l.name}
            </Link>
          ))}
        </div>
      )}
      {orders.length === 0 ? (
        <p className="card text-charcoal-muted">{t('Keine Bestellungen in dieser Ansicht.')}</p>
      ) : (
        <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/bestellungen/${o.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-4 py-3 hover:bg-surface-sunken">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-navy">{o.supplierName}</div>
                  <div className="text-sm text-charcoal-muted">
                    {o.number} · {o.locationName}
                  </div>
                  <div className="text-sm text-charcoal-muted">
                    {t('Lieferung')} {formatDay(o.deliveryDate, t.lang)} · {o.lineCount} {t('Pos. ·')} {formatChf(o.totalCents)}
                  </div>
                </div>
                <OrderStatusChip status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
