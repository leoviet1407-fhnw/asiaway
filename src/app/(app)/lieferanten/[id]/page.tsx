import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError } from '@/domain/errors';
import { requireAdmin } from '@/server/auth/current';
import { db } from '@/server/db';
import { getSupplier } from '@/server/services/catalog-service';
import { SupplierForm } from './SupplierForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Lieferant bearbeiten') };
}

export default async function SupplierEditPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    const s = await getSupplier(await db(), id);
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/lieferanten" className="text-sm text-charcoal-muted hover:text-navy">
          {t('← Lieferanten')}
        </Link>
        <h1 className="text-2xl">{s.name}</h1>
        <SupplierForm
          supplier={{
            id: s.id,
            name: s.name,
            orderEmail: s.orderEmail,
            ccEmail: s.ccEmail ?? '',
            phone: s.phone ?? '',
            orderChannel: s.orderChannel,
            deliveryDays: s.deliveryDays,
            cutoffNote: s.cutoffNote ?? '',
            minOrder: (s.minOrderCents / 100).toFixed(2),
            customerNumber: s.customerNumber ?? '',
            notes: s.notes ?? '',
            active: s.active,
          }}
        />
      </div>
    );
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
}
