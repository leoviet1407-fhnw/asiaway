import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { belowMinimum, canCancelOrder, canEditOrder, canReceiveOrder, canSendOrder, canSubmitOrder } from '@/domain/order';
import { formatAmount, formatChf, formatQty } from '@/domain/qty';
import { isOrderer } from '@/domain/roles';
import { formatDateTime, formatDay } from '@/lib/dates';
import { withBase } from '@/lib/base-path';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { STORAGE_AREA_LABEL, listItems, type StorageArea } from '@/server/services/catalog-service';
import { getOrder, getOrderHistory, previewSend, type OrderHistoryEntry } from '@/server/services/order-service';
import { listReceiptsForOrder } from '@/server/services/receiving-service';
import { OrderStatusChip } from '@/components/StatusChip';
import { startReceiptAction } from '../../../actions';
import { OrderActions } from './OrderActions';
import { OrderEditor } from './OrderEditor';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Bestellung') };
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const p = await requirePrincipal();
  const database = await db();
  let view: Awaited<ReturnType<typeof getOrder>>;
  try {
    view = await getOrder(database, p, id);
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const { order, supplier, location, lines, totalCents } = view;
  const editable = canEditOrder(p, order);
  const catalog = editable ? await listItems(database, { supplierId: supplier.id }) : [];
  const preview = canSendOrder(p, order) ? await previewSend(database, p, order.id) : null;
  const receipts = await listReceiptsForOrder(database, order.id);
  const openReceipt = receipts.find((r) => r.status === 'OPEN');
  const history = await getOrderHistory(database, p, order.id);

  return (
    <div className="space-y-4 pb-28">
      <div>
        <Link href="/bestellungen" className="text-sm text-charcoal-muted hover:text-navy">
          {t('← Bestellungen')}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl">{supplier.name}</h1>
          <OrderStatusChip status={order.status} />
        </div>
        <p className="text-charcoal-muted">
          {order.number} · {location.name}
          {supplier.deliveryDays && ` · ${t('Liefertage')} ${supplier.deliveryDays}`}
        </p>
        {supplier.cutoffNote && <p className="text-sm text-charcoal-muted">{supplier.cutoffNote}</p>}
      </div>

      <dl className="card grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Meta label={t('Erstellt')} value={`${view.createdBy?.name ?? '–'}, ${formatDateTime(order.createdAt)}`} />
        <Meta label={t('Eingereicht')} value={view.submittedBy ? `${view.submittedBy.name}, ${formatDateTime(order.submittedAt)}` : '–'} />
        <Meta label={t('Gesendet')} value={view.sentBy ? `${view.sentBy.name}, ${formatDateTime(order.sentAt)}` : '–'} />
        <Meta label={t('An')} value={order.sentTo ?? supplier.orderEmail} />
      </dl>

      {editable ? (
        <OrderEditor
          orderId={order.id}
          deliveryDate={order.deliveryDate ?? ''}
          note={order.note ?? ''}
          minOrderCents={supplier.minOrderCents}
          onlyOrderedInitially={order.status === 'SUBMITTED'}
          items={catalog.map((i) => {
            const offer = i.offers.find((o) => o.supplierId === supplier.id)!;
            const line = lines.find((l) => l.itemId === i.id);
            return {
              id: i.id,
              nameDe: i.nameDe,
              nameVi: i.nameVi,
              nameEn: i.nameEn,
              sku: offer.supplierSku ?? i.sku,
              area: t(STORAGE_AREA_LABEL[i.storageArea]),
              areaKey: i.storageArea,
              orderUnit: offer.orderUnit,
              priceCents: line?.unitPriceCents ?? offer.priceCents,
              isFresh: i.isFresh,
              isKeyItem: i.isKeyItem,
              qty: line?.qty ?? 0,
            };
          })}
        />
      ) : (
        <ReadOnlyLines lines={lines} totalCents={totalCents} minOrderCents={supplier.minOrderCents} deliveryDate={order.deliveryDate} note={order.note} />
      )}

      <OrderHistory history={history} open={order.status === 'SUBMITTED' || order.status === 'DRAFT'} />

      {preview && (
        <section className="card space-y-2 border-brand-600">
          <h2 className="text-lg">{t('E-Mail an den Lieferanten')}</h2>
          <p className="text-xs text-charcoal-muted">{t('Vorschau des gespeicherten Stands – nach Änderungen Seite neu laden. Gesendet wird immer der aktuelle Stand.')}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
            <dt className="font-semibold">{t('An')}</dt>
            <dd className="break-all">{preview.to}</dd>
            {preview.cc && (
              <>
                <dt className="font-semibold">{t('CC')}</dt>
                <dd className="break-all">{preview.cc}</dd>
              </>
            )}
            <dt className="font-semibold">{t('Antwort an')}</dt>
            <dd className="break-all">{preview.replyTo}</dd>
            <dt className="font-semibold">{t('Betreff')}</dt>
            <dd>{preview.subject}</dd>
          </dl>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-btn bg-surface-sunken p-3 font-sans text-sm">{preview.text}</pre>
          <a href={withBase(`/bestellungen/${order.id}/pdf`)} target="_blank" className="btn-secondary" rel="noreferrer">
            {t('PDF ansehen')}
          </a>
        </section>
      )}

      {order.sentAt && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {t('Gesendet an')} <strong>{order.sentTo}</strong> {t('am')} {formatDateTime(order.sentAt)}.
          </div>
          <a href={withBase(`/bestellungen/${order.id}/pdf`)} target="_blank" className="btn-secondary" rel="noreferrer">
            {t('Gesendetes PDF')}
          </a>
        </section>
      )}

      {receipts.length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-lg">{t('Lieferungen')}</h2>
          <ul className="space-y-1 text-sm">
            {receipts.map((r, i) => (
              <li key={r.id}>
                <Link className="text-brand-600 underline" href={r.status === 'OPEN' ? `/wareneingang/${r.id}` : `/wareneingang/${r.id}/abweichungen`}>
                  {t('Lieferung')} {receipts.length - i}
                </Link>{' '}
                – {r.status === 'OPEN' ? t('in Arbeit') : `${t('abgeschlossen')} ${formatDateTime(r.completedAt)}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <OrderActions
        orderId={order.id}
        canSubmit={canSubmitOrder(p, order)}
        submitLabel={isOrderer(p) ? t('Weiter zu Prüfen & Senden') : t('Zur Prüfung einreichen')}
        canSend={canSendOrder(p, order)}
        canReturn={isOrderer(p) && order.status === 'SUBMITTED'}
        canCancel={canCancelOrder(p, order)}
        status={order.status}
        sendTo={supplier.orderEmail}
      />

      {canReceiveOrder(p, order) && (
        <form action={startReceiptAction} className="fixed inset-x-0 bottom-16 z-20 px-4 md:static md:px-0">
          <input type="hidden" name="orderId" value={order.id} />
          <button className="btn-primary w-full shadow-lg md:w-auto">{openReceipt ? t('Wareneingang fortsetzen') : t('Wareneingang starten')}</button>
        </form>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-charcoal-muted">{label}</dt>
      <dd className="break-words text-navy">{value}</dd>
    </div>
  );
}

async function ReadOnlyLines({
  lines,
  totalCents,
  minOrderCents,
  deliveryDate,
  note,
}: {
  lines: Awaited<ReturnType<typeof getOrder>>['lines'];
  totalCents: number;
  minOrderCents: number;
  deliveryDate: string | null;
  note: string | null;
}) {
  const t = await getT();
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap gap-x-6 text-sm">
        <div>
          <span className="font-semibold">{t('Lieferung:')}</span> {formatDay(deliveryDate, t.lang)}
        </div>
        {note && (
          <div>
            <span className="font-semibold">{t('Bemerkung:')}</span> {note}
          </div>
        )}
      </div>
      <ul className="divide-y divide-surface-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="font-medium text-navy">{l.nameDe}</div>
              <div className="text-xs text-charcoal-muted">
                {t(STORAGE_AREA_LABEL[l.storageArea as StorageArea])} · {l.supplierSku ?? l.sku}
              </div>
            </div>
            <div className="whitespace-nowrap text-right">
              <div className="font-semibold">
                {formatAmount(l.qty, l.orderUnit)}
              </div>
              <div className="text-xs text-charcoal-muted">{formatChf(Math.round(l.qty * l.unitPriceCents))}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex justify-between border-t border-surface-line pt-2 font-semibold text-navy">
        <span>{lines.length} {t('Positionen')}</span>
        <span>{formatChf(totalCents)}</span>
      </div>
      {belowMinimum(totalCents, minOrderCents) && (
        <p className="rounded-btn bg-warn-50 p-2 text-sm text-warn-500">{t('Unter dem Mindestbestellwert von')} {formatChf(minOrderCents)}.</p>
      )}
    </section>
  );
}

/** Who added or changed what, so the review on Thursday shows who ordered which item. */
async function OrderHistory({ history, open }: { history: OrderHistoryEntry[]; open: boolean }) {
  const t = await getT();
  if (history.length === 0) return null;
  const lines = history.filter((h) => h.kind === 'line');
  // Per item the last person who set it (items now on the order only)
  const lastBy = new Map<string, { who: string; to: number }>();
  for (const h of lines) lastBy.set(h.itemName ?? '', { who: h.who, to: h.to ?? 0 });
  const perPerson = new Map<string, number>();
  for (const v of lastBy.values()) if (v.to > 0) perPerson.set(v.who, (perPerson.get(v.who) ?? 0) + 1);
  const when = (d: Date) => new Intl.DateTimeFormat(t.lang === 'th' ? 'th-TH-u-ca-gregory' : t.lang === 'en' ? 'en-GB' : 'de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(d);
  const event: Record<Exclude<OrderHistoryEntry['kind'], 'line'>, string> = {
    create: t('hat die Bestellung angelegt'),
    submit: t('hat zur Prüfung eingereicht'),
    return_to_draft: t('hat zurück in den Entwurf gesetzt'),
    cancel: t('hat die Bestellung storniert'),
    send: t('hat an den Lieferanten gesendet'),
  };
  return (
    <details className="card" open={open}>
      <summary className="cursor-pointer text-lg font-semibold text-navy">{t('Verlauf: wer hat was eingetragen')}</summary>
      {perPerson.size > 0 && (
        <p className="mt-2 text-sm text-charcoal-muted">
          {t('Artikel pro Person')}: {[...perPerson.entries()].map(([who, n]) => `${who} (${n})`).join(', ')}
        </p>
      )}
      <ol className="mt-3 divide-y divide-surface-line text-sm">
        {[...history].reverse().map((h, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
            <span>
              <strong className="text-navy">{h.who}</strong>{' '}
              {h.kind === 'line' ? (
                <>
                  {h.from === 0 ? t('hat hinzugefügt') : h.to === 0 ? t('hat entfernt') : t('hat geändert')}: <span className="text-navy">{h.itemName}</span>{' '}
                  <span className="whitespace-nowrap font-semibold">
                    {h.from === 0 ? `${formatQty(h.to ?? 0)}` : h.to === 0 ? `(${formatQty(h.from ?? 0)})` : `${formatQty(h.from ?? 0)} → ${formatQty(h.to ?? 0)}`}
                    {h.unit && h.to !== 0 ? ` ${h.unit}` : ''}
                  </span>
                </>
              ) : (
                event[h.kind]
              )}
            </span>
            <span className="text-xs text-charcoal-muted">{when(h.at)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
