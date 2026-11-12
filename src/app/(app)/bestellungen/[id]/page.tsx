import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { belowMinimum, canCancelOrder, canEditOrder, canReceiveOrder, canSendOrder, canSubmitOrder } from '@/domain/order';
import { formatAmount, formatChf } from '@/domain/qty';
import { isOrderer } from '@/domain/roles';
import { formatDateTime, formatDay } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { STORAGE_AREA_LABEL, listItems, type StorageArea } from '@/server/services/catalog-service';
import { getOrder, previewSend } from '@/server/services/order-service';
import { listReceiptsForOrder } from '@/server/services/receiving-service';
import { OrderStatusChip } from '@/components/StatusChip';
import { startReceiptAction } from '../../../actions';
import { OrderActions } from './OrderActions';
import { OrderEditor } from './OrderEditor';

export const metadata = { title: 'Bestellung' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <div className="space-y-4 pb-28">
      <div>
        <Link href="/bestellungen" className="text-sm text-charcoal-muted hover:text-navy">
          ← Bestellungen
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl">{supplier.name}</h1>
          <OrderStatusChip status={order.status} />
        </div>
        <p className="text-charcoal-muted">
          {order.number} · {location.name}
          {supplier.deliveryDays && ` · Liefertage ${supplier.deliveryDays}`}
        </p>
        {supplier.cutoffNote && <p className="text-sm text-charcoal-muted">{supplier.cutoffNote}</p>}
      </div>

      <dl className="card grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Meta label="Erstellt" value={`${view.createdBy?.name ?? '–'}, ${formatDateTime(order.createdAt)}`} />
        <Meta label="Eingereicht" value={view.submittedBy ? `${view.submittedBy.name}, ${formatDateTime(order.submittedAt)}` : '–'} />
        <Meta label="Gesendet" value={view.sentBy ? `${view.sentBy.name}, ${formatDateTime(order.sentAt)}` : '–'} />
        <Meta label="An" value={order.sentTo ?? supplier.orderEmail} />
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
              sku: offer.supplierSku ?? i.sku,
              area: STORAGE_AREA_LABEL[i.storageArea],
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

      {preview && (
        <section className="card space-y-2 border-brand-600">
          <h2 className="text-lg">E-Mail an den Lieferanten</h2>
          <p className="text-xs text-charcoal-muted">Vorschau des gespeicherten Stands – nach Änderungen Seite neu laden. Gesendet wird immer der aktuelle Stand.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
            <dt className="font-semibold">An</dt>
            <dd className="break-all">{preview.to}</dd>
            {preview.cc && (
              <>
                <dt className="font-semibold">CC</dt>
                <dd className="break-all">{preview.cc}</dd>
              </>
            )}
            <dt className="font-semibold">Antwort an</dt>
            <dd className="break-all">{preview.replyTo}</dd>
            <dt className="font-semibold">Betreff</dt>
            <dd>{preview.subject}</dd>
          </dl>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-btn bg-surface-sunken p-3 font-sans text-sm">{preview.text}</pre>
          <a href={`/bestellungen/${order.id}/pdf`} target="_blank" className="btn-secondary" rel="noreferrer">
            PDF ansehen
          </a>
        </section>
      )}

      {order.sentAt && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            Gesendet an <strong>{order.sentTo}</strong> am {formatDateTime(order.sentAt)}.
          </div>
          <a href={`/bestellungen/${order.id}/pdf`} target="_blank" className="btn-secondary" rel="noreferrer">
            Gesendetes PDF
          </a>
        </section>
      )}

      {receipts.length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-lg">Lieferungen</h2>
          <ul className="space-y-1 text-sm">
            {receipts.map((r, i) => (
              <li key={r.id}>
                <Link className="text-brand-600 underline" href={r.status === 'OPEN' ? `/wareneingang/${r.id}` : `/wareneingang/${r.id}/abweichungen`}>
                  Lieferung {receipts.length - i}
                </Link>{' '}
                – {r.status === 'OPEN' ? 'in Arbeit' : `abgeschlossen ${formatDateTime(r.completedAt)}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <OrderActions
        orderId={order.id}
        canSubmit={canSubmitOrder(p, order)}
        submitLabel={isOrderer(p) ? 'Weiter zu Prüfen & Senden' : 'Zur Prüfung einreichen'}
        canSend={canSendOrder(p, order)}
        canReturn={isOrderer(p) && order.status === 'SUBMITTED'}
        canCancel={canCancelOrder(p, order)}
        status={order.status}
        sendTo={supplier.orderEmail}
      />

      {canReceiveOrder(p, order) && (
        <form action={startReceiptAction} className="fixed inset-x-0 bottom-16 z-20 px-4 md:static md:px-0">
          <input type="hidden" name="orderId" value={order.id} />
          <button className="btn-primary w-full shadow-lg md:w-auto">{openReceipt ? 'Wareneingang fortsetzen' : 'Wareneingang starten'}</button>
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

function ReadOnlyLines({
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
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap gap-x-6 text-sm">
        <div>
          <span className="font-semibold">Lieferung:</span> {formatDay(deliveryDate)}
        </div>
        {note && (
          <div>
            <span className="font-semibold">Bemerkung:</span> {note}
          </div>
        )}
      </div>
      <ul className="divide-y divide-surface-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-baseline justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="font-medium text-navy">{l.nameDe}</div>
              <div className="text-xs text-charcoal-muted">
                {STORAGE_AREA_LABEL[l.storageArea as StorageArea]} · {l.supplierSku ?? l.sku}
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
        <span>{lines.length} Positionen</span>
        <span>{formatChf(totalCents)}</span>
      </div>
      {belowMinimum(totalCents, minOrderCents) && (
        <p className="rounded-btn bg-warn-50 p-2 text-sm text-warn-500">Unter dem Mindestbestellwert von {formatChf(minOrderCents)}.</p>
      )}
    </section>
  );
}
