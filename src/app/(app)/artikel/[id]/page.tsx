import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { requireItemEditor } from '@/server/auth/current';
import { db } from '@/server/db';
import { getItem, itemsWithoutBarcode, listSuppliers } from '@/server/services/catalog-service';
import { ItemForm } from './ItemForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Artikel bearbeiten') };
}

export default async function ItemEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string; aufgabe?: string }> }) {
  const t = await getT();
  await requireItemEditor();
  const { id } = await params;
  const { neu, aufgabe } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    const database = await db();
    const item = await getItem(database, id);
    const suppliers = (await listSuppliers(database)).map((s) => ({ id: s.id, name: s.name }));
    // Barcode task: the next item (alphabetical) that still has no barcode
    let nextHref: string | null = null;
    let left = 0;
    if (aufgabe === 'barcode') {
      const missing = (await itemsWithoutBarcode(database)).filter((x) => x.id !== item.id);
      left = missing.length;
      const next = missing.find((x) => x.nameDe.localeCompare(item.nameDe, 'de') > 0) ?? missing[0];
      nextHref = next ? `/artikel/${next.id}?aufgabe=barcode` : '/artikel';
    }
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href={aufgabe === 'barcode' ? '/artikel?ohne=barcode' : '/artikel'} className="text-sm text-charcoal-muted hover:text-navy">
          {t('← Artikel')}
        </Link>
        {nextHref && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-btn bg-navy-50 p-3 text-sm text-navy">
            <span>{t('Aufgabe Barcodes: noch {n} Artikel ohne Barcode.', { n: left })}</span>
            <Link href={nextHref} className="btn-secondary min-h-0 px-3 py-1.5 text-sm">{left > 0 ? t('Nächster Artikel ohne Barcode →') : t('Fertig – zur Liste')}</Link>
          </div>
        )}
        <h1 className="text-2xl">{item.nameDe}</h1>
        {neu && <p className="rounded-btn bg-ok-50 p-3 text-ok-500">{t('Artikel angelegt. Er erscheint jetzt im Bestellformular des Lieferanten.')}</p>}
        <ItemForm key={item.offers.map((o) => `${o.supplierItemId}${o.active}`).join()} item={item} suppliers={suppliers} />
      </div>
    );
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
}
