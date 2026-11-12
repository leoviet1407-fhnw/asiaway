import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { formatQty } from '@/domain/qty';
import { LINE_STATUS_LABEL, type LineStatus } from '@/domain/receiving';
import { formatDateTime, formatDay } from '@/lib/dates';
import { withBase } from '@/lib/base-path';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getReceiptView } from '@/server/services/receiving-service';
import { LineStatusChip, OrderStatusChip } from '@/components/StatusChip';
import { CompleteForm } from './CompleteForm';

export const metadata = { title: 'Abweichungen' };

const ORDER: LineStatus[] = ['MISSING', 'SHORT', 'WRONG', 'EXTRA', 'OK'];

export default async function DiscrepancyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fertig?: string }> }) {
  const { id } = await params;
  const { fertig } = await searchParams;
  const p = await requirePrincipal();
  let view: Awaited<ReturnType<typeof getReceiptView>>;
  try {
    view = await getReceiptView(await db(), p, id);
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const open = view.receipt.status === 'OPEN';
  const lineInfo = new Map(view.lines.map((l) => [l.itemId, l]));
  const rows = [...view.rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || Number(b.damaged) - Number(a.damaged));
  const name = (r: (typeof rows)[number]) =>
    r.itemId ? lineInfo.get(r.itemId)?.nameDe ?? view.itemNames[r.itemId]?.nameDe ?? 'Artikel' : `Unbekannter Barcode ${r.scannedCode}`;
  const unit = (r: (typeof rows)[number]) => (r.itemId ? lineInfo.get(r.itemId)?.orderUnit ?? view.itemNames[r.itemId]?.stockUnit ?? '' : 'Stk');
  const notes = new Map(view.current.map((c) => [c.itemId ?? `code:${c.scannedCode}`, c.note]));

  return (
    <div className="space-y-4 pb-24">
      <div>
        <Link href={open ? `/wareneingang/${id}` : `/bestellungen/${view.order.id}`} className="text-sm text-charcoal-muted hover:text-navy">
          ← {open ? 'Zurück zum Scannen' : 'Zur Bestellung'}
        </Link>
        <h1 className="mt-1 text-2xl">Abweichungen</h1>
        <p className="text-charcoal-muted">
          {view.order.supplierName} · {view.order.locationName} · {view.order.number} · Lieferung {formatDay(view.order.deliveryDate)}
        </p>
      </div>

      {fertig && (
        <div className="flex flex-wrap items-center gap-2 rounded-btn bg-ok-50 p-3 text-ok-500">
          <strong>Lieferung abgeschlossen.</strong> Bestellung jetzt: <OrderStatusChip status={view.order.status} />
        </div>
      )}
      {!open && (
        <p className="text-sm text-charcoal-muted">
          Erfasst von {view.startedBy ?? '–'}, abgeschlossen von {view.completedBy ?? '–'} am {formatDateTime(view.receipt.completedAt)}
          {view.receipt.note && ` · Notiz: ${view.receipt.note}`}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ORDER.map((s) => (
          <div key={s} className="card p-2 text-center">
            <div className="text-2xl font-bold text-navy">{view.summary.counts[s]}</div>
            <div className="text-xs text-charcoal-muted">{LINE_STATUS_LABEL[s]}</div>
          </div>
        ))}
        <div className="card p-2 text-center">
          <div className="text-2xl font-bold text-brand-600">{view.summary.damaged}</div>
          <div className="text-xs text-charcoal-muted">Beschädigt</div>
        </div>
      </div>

      {view.summary.allOk && <p className="rounded-btn bg-ok-50 p-3 font-semibold text-ok-500">Alles wie bestellt geliefert.</p>}

      <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[1fr_auto] gap-x-3 px-3 py-2">
            <div className="min-w-0">
              <div className="font-medium text-navy">{name(r)}</div>
              <div className="text-xs text-charcoal-muted">
                {r.onOrder ? (
                  <>
                    bestellt {formatQty(r.ordered)}
                    {r.before > 0 && ` · früher ${formatQty(r.before)}`} · jetzt {formatQty(r.now)}
                    {r.open > 0 && <span className="font-semibold text-brand-600"> · offen {formatQty(r.open)}</span>} {unit(r)}
                  </>
                ) : (
                  <>
                    geliefert {formatQty(r.now)} {unit(r)} · nicht bestellt
                  </>
                )}
              </div>
              {(r.damaged || notes.get(r.key)) && (
                <div className="text-xs font-semibold text-brand-600">
                  {r.damaged && 'Beschädigt'}
                  {notes.get(r.key) && ` – ${notes.get(r.key)}`}
                </div>
              )}
            </div>
            <div className="self-center">
              <LineStatusChip status={r.status} />
            </div>
          </li>
        ))}
      </ul>

      {view.photos.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg">Fotos</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {view.photos.map((ph) => (
              <a key={ph.id} href={withBase(`/wareneingang/foto/${ph.id}`)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-btn border border-surface-line bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={withBase(`/wareneingang/foto/${ph.id}`)} alt={ph.kind === 'DAMAGE' ? 'Schaden' : 'Lieferschein'} className="aspect-square w-full object-cover" />
                <div className="px-1 py-0.5 text-center text-xs">{ph.kind === 'DAMAGE' ? 'Schaden' : 'Lieferschein'}</div>
              </a>
            ))}
          </div>
        </section>
      )}

      {open && <CompleteForm receiptId={id} complete={view.summary.complete} />}
    </div>
  );
}
