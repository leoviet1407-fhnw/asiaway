import Link from 'next/link';
import { isOrderer } from '@/domain/roles';
import { formatChf } from '@/domain/qty';
import { formatDay } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listOrders } from '@/server/services/order-service';
import { listReceivable } from '@/server/services/receiving-service';
import { OrderStatusChip } from '@/components/StatusChip';
import { Icon } from '@/components/Icon';

export const metadata = { title: 'Start' };

export default async function HomePage() {
  const p = await requirePrincipal();
  const database = await db();
  const drafts = await listOrders(database, p, { statuses: ['DRAFT'] });
  const submitted = await listOrders(database, p, { statuses: ['SUBMITTED'] });
  const deliveries = await listReceivable(database, p);
  const orderer = isOrderer(p);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Hallo {p.name.split(' ')[0]}</h1>
        <p className="text-charcoal-muted">Was steht heute an?</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/tagesabschluss/neu" className="btn-secondary col-span-2 h-14 text-base">
          <Icon name="cash" className="h-6 w-6" />
          Tagesabschluss
        </Link>
        <Link href="/bestellungen/neu" className="btn-primary h-20 flex-col text-base">
          <Icon name="cart" className="h-6 w-6" />
          Neue Bestellung
        </Link>
        <Link href="/wareneingang" className="btn-secondary h-20 flex-col text-base">
          <Icon name="scan" className="h-6 w-6" />
          Wareneingang
        </Link>
      </div>

      {orderer && (
        <Section title="Zur Prüfung" count={submitted.length} empty="Keine Bestellungen warten auf Prüfung.">
          {submitted.map((o) => (
            <OrderRow key={o.id} o={o} />
          ))}
        </Section>
      )}

      <Section title="Offene Entwürfe" count={drafts.length} empty="Keine offenen Entwürfe.">
        {drafts.map((o) => (
          <OrderRow key={o.id} o={o} />
        ))}
      </Section>

      {!orderer && submitted.length > 0 && (
        <Section title="Beim Besteller zur Prüfung" count={submitted.length} empty="">
          {submitted.map((o) => (
            <OrderRow key={o.id} o={o} />
          ))}
        </Section>
      )}

      <Section title="Erwartete Lieferungen" count={deliveries.length} empty="Keine Lieferungen erwartet.">
        {deliveries.map((d) => (
          <li key={d.id}>
            <Link href="/wareneingang" className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken">
              <div>
                <div className="font-semibold text-navy">{d.supplierName}</div>
                <div className="text-sm text-charcoal-muted">
                  {d.locationName} · {d.number} · {formatDay(d.deliveryDate)}
                </div>
              </div>
              <OrderStatusChip status={d.status} />
            </Link>
          </li>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-lg">
        {title}
        <span className="chip bg-navy-50 text-navy">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="card text-sm text-charcoal-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">{children}</ul>
      )}
    </section>
  );
}

function OrderRow({ o }: { o: Awaited<ReturnType<typeof listOrders>>[number] }) {
  return (
    <li>
      <Link href={`/bestellungen/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken">
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy">{o.supplierName}</div>
          <div className="text-sm text-charcoal-muted">
            {o.locationName} · {o.lineCount} Pos. · {formatChf(o.totalCents)}
          </div>
        </div>
        <OrderStatusChip status={o.status} />
      </Link>
    </li>
  );
}
