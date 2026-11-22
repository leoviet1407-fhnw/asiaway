import Link from 'next/link';
import { requireOrderer } from '@/server/auth/current';
import { db } from '@/server/db';
import { listSuppliers } from '@/server/services/catalog-service';
import { ItemForm } from '../[id]/ItemForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Neuer Artikel') };
}

export default async function NewItemPage({ searchParams }: { searchParams: Promise<{ lieferant?: string }> }) {
  const t = await getT();
  await requireOrderer();
  const { lieferant } = await searchParams;
  const suppliers = (await listSuppliers(await db())).map((s) => ({ id: s.id, name: s.name }));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/artikel" className="text-sm text-charcoal-muted hover:text-navy">
        {t('← Artikel')}
      </Link>
      <h1 className="text-2xl">{t('Neuer Artikel')}</h1>
      <ItemForm suppliers={suppliers} {...(suppliers.some((s) => s.id === lieferant) ? { defaultSupplierId: lieferant } : {})} />
    </div>
  );
}
