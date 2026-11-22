import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { requireOrderer } from '@/server/auth/current';
import { db } from '@/server/db';
import { getItem, listSuppliers } from '@/server/services/catalog-service';
import { ItemForm } from './ItemForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Artikel bearbeiten') };
}

export default async function ItemEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string }> }) {
  const t = await getT();
  await requireOrderer();
  const { id } = await params;
  const { neu } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    const database = await db();
    const item = await getItem(database, id);
    const suppliers = (await listSuppliers(database)).map((s) => ({ id: s.id, name: s.name }));
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/artikel" className="text-sm text-charcoal-muted hover:text-navy">
          {t('← Artikel')}
        </Link>
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
