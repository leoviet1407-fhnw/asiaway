import { notFound, redirect } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { formatDay } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { STORAGE_AREA_LABEL, type StorageArea } from '@/server/services/catalog-service';
import { getReceiptView } from '@/server/services/receiving-service';
import { Receiver } from './Receiver';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Wareneingang') };
}

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const p = await requirePrincipal();
  let view: Awaited<ReturnType<typeof getReceiptView>>;
  try {
    view = await getReceiptView(await db(), p, id);
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  if (view.receipt.status !== 'OPEN') redirect(`/wareneingang/${id}/abweichungen`);

  return (
    <Receiver
      receiptId={id}
      title={view.order.supplierName}
      subtitle={`${view.order.locationName} · ${view.order.number} · ${t('Lieferung')} ${formatDay(view.order.deliveryDate, t.lang)}`}
      lines={view.lines.map((l) => ({
        itemId: l.itemId,
        nameDe: l.nameDe,
        nameVi: l.nameVi,
        area: t(STORAGE_AREA_LABEL[l.storageArea as StorageArea]),
        isFresh: l.isFresh,
        orderUnit: l.orderUnit,
        ordered: l.ordered,
        before: l.before,
        expectedNow: l.expectedNow,
        hasBarcode: l.barcodes.length > 0,
      }))}
      current={view.current}
      barcodes={view.barcodes}
      itemNames={view.itemNames}
      photoCount={{
        DELIVERY_NOTE: view.photos.filter((ph) => ph.kind === 'DELIVERY_NOTE').length,
        DAMAGE: view.photos.filter((ph) => ph.kind === 'DAMAGE').length,
      }}
    />
  );
}
