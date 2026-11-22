import Link from 'next/link';
import { requireOrderer } from '@/server/auth/current';
import { SupplierForm } from '../[id]/SupplierForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Neuer Lieferant') };
}

export default async function NewSupplierPage() {
  const t = await getT();
  await requireOrderer();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/lieferanten" className="text-sm text-charcoal-muted hover:text-navy">
        {t('← Lieferanten')}
      </Link>
      <h1 className="text-2xl">{t('Neuer Lieferant')}</h1>
      <SupplierForm
        supplier={{ id: '', name: '', orderEmail: '', ccEmail: '', phone: '', orderChannel: 'EMAIL', deliveryDays: '', cutoffNote: '', minOrder: '0.00', customerNumber: '', notes: '', active: true }}
      />
    </div>
  );
}
