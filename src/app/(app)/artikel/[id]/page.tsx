import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { requireAdmin } from '@/server/auth/current';
import { db } from '@/server/db';
import { getItem } from '@/server/services/catalog-service';
import { ItemForm } from './ItemForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Artikel bearbeiten') };
}

export default async function ItemEditPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    const item = await getItem(await db(), id);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/artikel" className="text-sm text-charcoal-muted hover:text-navy">
          {t('← Artikel')}
        </Link>
        <h1 className="text-2xl">{item.nameDe}</h1>
        <ItemForm item={item} />
      </div>
    );
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
}
