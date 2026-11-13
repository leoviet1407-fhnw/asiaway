import { DEFAULT_FLOAT_CENTS, stationsFor } from '@/domain/closing';
import { locationsFor } from '@/domain/roles';
import { todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listRestaurants } from '@/server/services/catalog-service';
import { ClosingForm } from '../ClosingForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Neuer Abschluss') };
}

export default async function NewClosingPage({ searchParams }: { searchParams: Promise<{ ort?: string; datum?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  const params = await searchParams;
  const locations = locationsFor(p, await listRestaurants(await db()));
  if (locations.length === 0) return <p className="card">{t('Ihrem Konto ist kein Standort zugeordnet.')}</p>;
  const today = todayIso();
  const location = locations.find((l) => l.id === params.ort) ?? locations[0]!;
  const date = params.datum && /^\d{4}-\d{2}-\d{2}$/.test(params.datum) && params.datum <= today ? params.datum : today;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl">{t('Tagesabschluss')}</h1>
        <p className="text-charcoal-muted">{t('Kasse zählen, Beträge eintragen. Alles andere rechnet die App.')}</p>
      </div>
      <ClosingForm
        maxDate={today}
        locked={false}
        locations={locations.map((l) => ({ id: l.id, name: l.name, stations: [...stationsFor(l.id)] }))}
        values={{
          locationId: location.id,
          businessDate: date,
          station: stationsFor(location.id)[0]!,
          cashCounted: '',
          startFloat: (DEFAULT_FLOAT_CENTS / 100).toFixed(2),
          eft: '',
          mobile: '',
          posGross: '',
          note: '',
        }}
      />
    </div>
  );
}
