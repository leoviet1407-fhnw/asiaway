import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CLOSING_STATUS_LABEL, DIFFERENCE_LABEL, differenceTone, stationsFor } from '@/domain/closing';
import { DomainError } from '@/domain/errors';
import { formatChf } from '@/domain/qty';
import { isOrderer, locationsFor } from '@/domain/roles';
import { formatDateTime, formatDay, todayIso } from '@/lib/dates';
import { withBase } from '@/lib/base-path';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listLocations } from '@/server/services/catalog-service';
import { getClosing, listClosingPhotos } from '@/server/services/closing-service';
import { ClosingForm } from '../ClosingForm';
import { ClosingActions } from './ClosingActions';

export const metadata = { title: 'Tagesabschluss' };

export default async function ClosingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gespeichert?: string }> }) {
  const { id } = await params;
  const { gespeichert } = await searchParams;
  const p = await requirePrincipal();
  const database = await db();
  let closing: Awaited<ReturnType<typeof getClosing>>;
  try {
    closing = await getClosing(database, p, id);
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  const photos = await listClosingPhotos(database, p, id);
  const locations = locationsFor(p, await listLocations(database));
  const approved = closing.status === 'APPROVED';
  const tone = differenceTone(closing.result.differenceCents);
  const chf = (c: number) => (c / 100).toFixed(2);

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-8">
      <div>
        <Link href="/tagesabschluss" className="text-sm text-charcoal-muted hover:text-navy">← Abschlüsse</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl">{formatDay(closing.businessDate)}</h1>
          <span className={`chip ${approved ? 'bg-ok-50 text-ok-500' : 'bg-warn-50 text-warn-500'}`}>{CLOSING_STATUS_LABEL[closing.status]}</span>
        </div>
        <p className="text-charcoal-muted">{closing.locationName} · {closing.station}</p>
        <p className="text-xs text-charcoal-muted">
          Abgeschlossen von {closing.closedByName ?? '–'} ({formatDateTime(closing.createdAt)})
          {approved && ` · Freigegeben von ${closing.approvedByName ?? '–'} (${formatDateTime(closing.approvedAt)})`}
        </p>
      </div>

      {gespeichert && <p className="rounded-btn bg-ok-50 p-3 font-semibold text-ok-500">Gespeichert.</p>}

      {approved ? (
        <section className="card space-y-2">
          <Row label="Cashbestand (Kassa)" value={chf(closing.cashCountedCents)} />
          <Row label="− Anfangsbestand" value={chf(closing.startFloatCents)} />
          <Row label="= Barumsatz" value={chf(closing.result.cashSalesCents)} strong />
          <Row label="+ EFT" value={chf(closing.eftCents)} />
          <Row label="+ Mobile Payment" value={chf(closing.mobileCents)} />
          <Row label="TOTAL (IST)" value={chf(closing.result.totalActualCents)} strong />
          <Row label="Kassen-Brutto (SOLL)" value={chf(closing.posGrossCents)} />
          <Row label={`Differenz – ${DIFFERENCE_LABEL[tone]}`} value={chf(closing.result.differenceCents)} strong />
          <Row label="BANK EINZAHLEN" value={chf(closing.result.bankDepositCents)} strong />
          {closing.note && <p className="border-t border-surface-line pt-2 text-sm">Notiz: {closing.note}</p>}
          <p className="text-xs text-charcoal-muted">Gesperrt. Zum Ändern muss ein Besteller oder Admin den Abschluss wieder öffnen.</p>
        </section>
      ) : (
        <ClosingForm
          maxDate={todayIso()}
          locked
          locations={locations.map((l) => ({ id: l.id, name: l.name, stations: [...stationsFor(l.id)] }))}
          values={{
            id: closing.id,
            locationId: closing.locationId,
            businessDate: closing.businessDate,
            station: closing.station,
            cashCounted: chf(closing.cashCountedCents),
            startFloat: chf(closing.startFloatCents),
            eft: chf(closing.eftCents),
            mobile: closing.mobileCents ? chf(closing.mobileCents) : '',
            posGross: chf(closing.posGrossCents),
            note: closing.note ?? '',
          }}
        />
      )}

      <ClosingActions
        closingId={id}
        approved={approved}
        canApprove={isOrderer(p)}
        photos={photos.map((ph) => ph.id)}
        photoBase={withBase('/tagesabschluss/foto')}
      />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-surface-line pt-2 font-bold text-navy' : ''}`}>
      <span>{label}</span>
      <span>CHF {value}</span>
    </div>
  );
}
