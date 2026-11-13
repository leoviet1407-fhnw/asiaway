import { formatChf } from '@/domain/qty';
import { locationsFor } from '@/domain/roles';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listOrderLocations, listSuppliers } from '@/server/services/catalog-service';
import { NewOrderForm } from './NewOrderForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Neue Bestellung') };
}

export default async function NewOrderPage() {
  const t = await getT();
  const p = await requirePrincipal();
  const database = await db();
  const locations = locationsFor(p, await listOrderLocations(database));
  const suppliers = await listSuppliers(database);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl">{t('Neue Bestellung')}</h1>
      <p className="text-charcoal-muted">
        {t('Pro Standort und Lieferant gibt es einen Entwurf. Ist schon einer offen, wird er geöffnet.')}
      </p>
      <NewOrderForm
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        suppliers={suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          info: [s.deliveryDays && `${t('Liefertage')}: ${s.deliveryDays}`, s.minOrderCents > 0 && `${t('Mindestbestellung')} ${formatChf(s.minOrderCents)}`, s.cutoffNote]
            .filter(Boolean)
            .join(' · '),
        }))}
      />
    </div>
  );
}
