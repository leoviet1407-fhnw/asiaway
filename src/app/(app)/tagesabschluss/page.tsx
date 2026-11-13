import Link from 'next/link';
import { DIFFERENCE_LABEL, differenceTone, type DifferenceTone } from '@/domain/closing';
import { formatChf } from '@/domain/qty';
import { isOrderer, locationsFor } from '@/domain/roles';
import { formatDay, todayIso } from '@/lib/dates';
import { withBase } from '@/lib/base-path';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listRestaurants } from '@/server/services/catalog-service';
import { listClosings, sumClosings } from '@/server/services/closing-service';

export const metadata = { title: 'Tagesabschluss' };

const TONE_STYLE: Record<DifferenceTone, string> = { ok: 'bg-ok-50 text-ok-500', tips: 'bg-info-50 text-info-500', short: 'bg-brand-600 text-white' };

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function ClosingsPage({ searchParams }: { searchParams: Promise<{ monat?: string; ort?: string }> }) {
  const p = await requirePrincipal();
  const params = await searchParams;
  const database = await db();
  const month = params.monat && /^\d{4}-\d{2}$/.test(params.monat) ? params.monat : todayIso().slice(0, 7);
  const locs = locationsFor(p, await listRestaurants(database));
  const locationId = locs.some((l) => l.id === params.ort) ? params.ort : undefined;
  const list = await listClosings(database, p, { month, ...(locationId ? { locationId } : {}) });
  const sum = sumClosings(list);
  const href = (m: string, ort?: string) => `/tagesabschluss?monat=${m}${ort ? `&ort=${ort}` : ''}`;
  const monthLabel = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl">Tagesabschluss</h1>
        <Link href="/tagesabschluss/neu" className="btn-primary">+ Neu</Link>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Link href={href(shiftMonth(month, -1), locationId)} className="btn-secondary px-3" aria-label="Vormonat">←</Link>
        <div className="font-semibold capitalize text-navy">{monthLabel}</div>
        <Link href={href(shiftMonth(month, 1), locationId)} className="btn-secondary px-3" aria-label="Folgemonat">→</Link>
      </div>

      {locs.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          <Link href={href(month)} className={`chip whitespace-nowrap px-3 py-1 ${!locationId ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>Alle Standorte</Link>
          {locs.map((l) => (
            <Link key={l.id} href={href(month, l.id)} className={`chip whitespace-nowrap px-3 py-1 ${locationId === l.id ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{l.name}</Link>
          ))}
        </div>
      )}

      {list.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Kassen-Brutto" value={formatChf(sum.posGrossCents)} />
          <Stat label="Bank einzahlen" value={formatChf(sum.bankDepositCents)} />
          <Stat label="Trinkgeld" value={formatChf(sum.tipsCents)} />
          <Stat label="Fehlbeträge" value={formatChf(sum.shortfallCents)} danger={sum.shortfallCents > 0} />
        </div>
      )}

      {list.length === 0 ? (
        <p className="card text-charcoal-muted">Keine Abschlüsse in diesem Monat.</p>
      ) : (
        <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
          {list.map((c) => {
            const tone = differenceTone(c.result.differenceCents);
            return (
              <li key={c.id}>
                <Link href={`/tagesabschluss/${c.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-3 px-4 py-3 hover:bg-surface-sunken">
                  <div className="min-w-0">
                    <div className="font-semibold text-navy">{formatDay(c.businessDate)}</div>
                    <div className="text-sm text-charcoal-muted">{c.locationName} · {c.station}</div>
                    <div className="text-sm text-charcoal-muted">Brutto {formatChf(c.posGrossCents)} · Bank {formatChf(c.result.bankDepositCents)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`chip ${TONE_STYLE[tone]}`}>{tone === 'ok' ? DIFFERENCE_LABEL.ok : `${tone === 'short' ? '−' : '+'}${formatChf(Math.abs(c.result.differenceCents)).replace('CHF ', '')}`}</span>
                    <span className="text-xs text-charcoal-muted">{c.status === 'APPROVED' ? '✓ freigegeben' : 'offen zur Freigabe'}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {isOrderer(p) && (
        <a href={withBase(`/tagesabschluss/export?monat=${month}${locationId ? `&ort=${locationId}` : ''}`)} className="btn-secondary">
          Monat als CSV exportieren
        </a>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-charcoal-muted">{label}</div>
      <div className={`text-lg font-bold ${danger ? 'text-brand-600' : 'text-navy'}`}>{value}</div>
    </div>
  );
}
