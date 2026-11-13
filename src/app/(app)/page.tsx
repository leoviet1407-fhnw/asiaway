import Link from 'next/link';
import { isOrderer } from '@/domain/roles';
import { formatChf } from '@/domain/qty';
import { formatDay, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { dueMonth, firstOpenDate } from '@/domain/roster';
import { getAvailabilityMonth, getProfile } from '@/server/services/roster-service';
import { listOrders } from '@/server/services/order-service';
import { listReceivable } from '@/server/services/receiving-service';
import { OrderStatusChip } from '@/components/StatusChip';
import { Icon, type IconName } from '@/components/Icon';
import { RESERVATIONS_URL } from '@/lib/site-images';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Start') };
}

export default async function HomePage() {
  const t = await getT();
  const p = await requirePrincipal();
  const database = await db();
  const drafts = await listOrders(database, p, { statuses: ['DRAFT'] });
  const submitted = await listOrders(database, p, { statuses: ['SUBMITTED'] });
  const deliveries = await listReceivable(database, p);
  const orderer = isOrderer(p);
  const profile = await getProfile(database, p.userId);
  const month = dueMonth(todayIso());
  const reported = profile ? (await getAvailabilityMonth(database, p, p.userId, month)).submittedAt !== null : true;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl">{t('Hallo')} {p.name.split(' ')[0]}</h1>

      {!reported && (
        <Link href={`/dienstplan/verfuegbarkeit?monat=${month}`} className="block rounded-btn bg-brand-600 p-4 text-white">
          <div className="font-semibold">{t('Verfügbarkeit & Ferien melden')}</div>
          <div className="text-sm text-white/85">{t('Für {month} – bitte ab {date} einen Monat im Voraus eintragen →', { month: `${month.slice(5)}/${month.slice(0, 4)}`, date: formatDay(firstOpenDate(todayIso()), t.lang) })}</div>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Action href="/bestellungen/neu" icon="cart" label={t('Neue Bestellung')} primary />
        <Action href="/wareneingang" icon="scan" label={t('Wareneingang')} badge={deliveries.length} />
        <Action href="/tagesabschluss/neu" icon="cash" label={t('Tagesabschluss')} />
        <Action href="/dienstplan" icon="calendar" label={t('Dienstplan')} />
        {orderer && <Action href="/dienstplan/uebersicht" icon="calendar" label={t('Übersicht')} />}
        <Action href={RESERVATIONS_URL} icon="calendar" label={t('Reservationen')} external />
      </div>

      {orderer && (
        <Section title={t('Zur Prüfung')} count={submitted.length} empty={t('Keine Bestellungen warten auf Prüfung.')}>
          {submitted.map((o) => (
            <OrderRow key={o.id} o={o} />
          ))}
        </Section>
      )}

      <Section title={t('Offene Entwürfe')} count={drafts.length} empty={t('Keine offenen Entwürfe.')}>
        {drafts.map((o) => (
          <OrderRow key={o.id} o={o} />
        ))}
      </Section>

      {!orderer && submitted.length > 0 && (
        <Section title={t('Beim Besteller zur Prüfung')} count={submitted.length} empty="">
          {submitted.map((o) => (
            <OrderRow key={o.id} o={o} />
          ))}
        </Section>
      )}

      <Section title={t('Erwartete Lieferungen')} count={deliveries.length} empty={t('Keine Lieferungen erwartet.')}>
        {deliveries.map((d) => (
          <li key={d.id}>
            <Link href="/wareneingang" className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken">
              <div>
                <div className="font-semibold text-navy">{d.supplierName}</div>
                <div className="text-sm text-charcoal-muted">
                  {d.locationName} · {d.number} · {formatDay(d.deliveryDate, t.lang)}
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
      <h2 className="h-site mb-3 flex items-center gap-2">
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

async function OrderRow({ o }: { o: Awaited<ReturnType<typeof listOrders>>[number] }) {
  const t = await getT();
  return (
    <li>
      <Link href={`/bestellungen/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken">
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy">{o.supplierName}</div>
          <div className="text-sm text-charcoal-muted">
            {o.locationName} · {o.lineCount} {t('Pos. ·')} {formatChf(o.totalCents)}
          </div>
        </div>
        <OrderStatusChip status={o.status} />
      </Link>
    </li>
  );
}

function Action({ href, icon, label, primary, badge, external }: { href: string; icon: IconName; label: string; primary?: boolean; badge?: number; external?: boolean }) {
  const className = `${primary ? 'btn-primary' : 'btn-secondary'} relative h-20 flex-col gap-1 text-center normal-case tracking-normal`;
  const body = (
    <>
      <Icon name={icon} className="h-6 w-6" />
      <span className="text-base font-semibold">{label}</span>
      {badge ? <span className="absolute right-2 top-2 rounded-full bg-brand-600 px-2 text-xs font-bold text-white">{badge}</span> : null}
    </>
  );
  return external ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
