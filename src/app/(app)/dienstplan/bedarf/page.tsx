import Link from 'next/link';
import { redirect } from 'next/navigation';
import { coverageState, type CoverageState } from '@/domain/availability';
import { isOrderer } from '@/domain/roles';
import { ROSTER_SITES, addDays, mondayOf, weekDates, weekdayShort } from '@/domain/roster';
import { getT } from '@/i18n/server';
import { formatDay, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getCoverage, getNeeds } from '@/server/services/coverage-service';
import { NeedsForm } from './NeedsForm';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Bedarf & Abdeckung') };
}

const STYLE: Record<CoverageState, string> = {
  ok: 'bg-ok-50 text-ok-500',
  tight: 'bg-warn-50 text-warn-500',
  gap: 'bg-brand-600 text-white',
  none: 'bg-surface-sunken text-charcoal-muted',
};

export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ site?: string; woche?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  if (!isOrderer(p)) redirect('/dienstplan');
  const params = await searchParams;
  const site = ROSTER_SITES.find((s) => s.id === params.site) ?? ROSTER_SITES.find((s) => s.id === 'winterthur')!;
  const weekStart = mondayOf(params.woche && /^\d{4}-\d{2}-\d{2}$/.test(params.woche) ? params.woche : addDays(todayIso(), 28));
  const database = await db();
  const [coverage, needs] = await Promise.all([getCoverage(database, p, site.id, weekStart), getNeeds(database, p, site.id)]);
  const href = (over: { site?: string; woche?: string }) => `/dienstplan/bedarf?site=${over.site ?? site.id}&woche=${over.woche ?? weekStart}`;
  const { totals } = coverage;
  const gaps = coverage.days.flatMap((d) => [coverageState(d.need.lunchPeople, d.offeredLunch) === 'gap' ? 1 : 0, coverageState(d.need.dinnerPeople, d.offeredDinner) === 'gap' ? 1 : 0]).reduce((a: number, b) => a + b, 0);
  const hasNeed = totals.needHours > 0;
  const missingContract = Math.max(0, totals.needHours - totals.contractHours);

  return (
    <div className="space-y-5 pb-10">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">← {t('Dienstplan')}</Link>
        <h1 className="mt-1 text-2xl">{t('Bedarf & Abdeckung')}</h1>
        <p className="text-charcoal-muted">{t('Wie viele Personen gebraucht werden, und wie viele sich gemeldet haben.')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ROSTER_SITES.map((s) => (
          <Link key={s.id} href={href({ site: s.id })} className={`chip px-3 py-1 ${s.id === site.id ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{s.name}</Link>
        ))}
        <span className="ml-auto flex items-center gap-2 text-sm">
          <Link href={href({ woche: addDays(weekStart, -7) })} className="btn-secondary min-h-0 px-3 py-1" aria-label={t('Vorwoche')}>←</Link>
          <span className="font-semibold text-navy">{t('Woche ab')} {formatDay(weekStart, t.lang)}</span>
          <Link href={href({ woche: addDays(weekStart, 7) })} className="btn-secondary min-h-0 px-3 py-1" aria-label={t('Folgewoche')}>→</Link>
        </span>
      </div>

      {!hasNeed ? (
        <p className="rounded-btn bg-warn-50 p-3 text-warn-500">{t('Der Bedarf ist noch nicht festgelegt. Tragen Sie unten ein, wie viele Personen pro Tag gebraucht werden, oder übernehmen Sie ihn aus einer geplanten Woche.')}</p>
      ) : (
        <p className={`rounded-btn p-3 font-semibold ${gaps === 0 ? 'bg-ok-50 text-ok-500' : 'bg-brand-600 text-white'}`}>
          {gaps === 0 ? t('Alle Dienste sind durch Meldungen abgedeckt.') : t('{n} Dienste sind noch nicht durch Meldungen abgedeckt.', { n: gaps })}
        </p>
      )}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label={t('Bedarf')} value={`${totals.needHours.toFixed(1)} h`} hint={t('pro Woche')} />
        <Kpi label={t('Verträge des Teams')} value={`${totals.contractHours.toFixed(1)} h`} hint={missingContract > 0 ? t('{n} h zu wenig', { n: missingContract.toFixed(1) }) : t('reicht')} bad={missingContract > 0} />
        <Kpi label={t('Gemeldet')} value={`${totals.offeredHours.toFixed(1)} h`} hint={coverage.silent.length ? t('{n} ohne Meldung', { n: coverage.silent.length }) : t('alle haben gemeldet')} />
        <Kpi label={t('Geplant')} value={`${totals.plannedHours.toFixed(1)} h`} />
      </section>

      <section className="card space-y-2">
        <h2 className="h-site">{t('Abdeckung pro Tag')}</h2>
        <p className="text-xs text-charcoal-muted">{t('Pro Dienst: Gemeldet / Bedarf. Darunter, wie viele schon eingeteilt sind.')}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-charcoal-muted">
                <th className="py-1">{t('Tag')}</th>
                <th className="py-1">{t('Mittag')}</th>
                <th className="py-1">{t('Abend')}</th>
              </tr>
            </thead>
            <tbody>
              {coverage.days.map((d) => (
                <tr key={d.date} className="border-t border-surface-line">
                  <td className="py-1.5 font-semibold text-navy">{weekdayShort(d.date, t.lang)} {d.date.slice(8)}.{d.date.slice(5, 7)}.</td>
                  <Cell need={d.need.lunchPeople} offered={d.offeredLunch} planned={d.plannedLunch} plannedLabel={t('eingeteilt')} />
                  <Cell need={d.need.dinnerPeople} offered={d.offeredDinner} planned={d.plannedDinner} plannedLabel={t('eingeteilt')} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {coverage.silent.length > 0 && <p className="text-xs text-charcoal-muted">{t('Noch keine Meldung für diese Woche:')} {coverage.silent.join(', ')}</p>}
      </section>

      <NeedsForm site={site.id} weekStart={weekStart} needs={needs} dates={weekDates(weekStart)} />
    </div>
  );
}

function Cell({ need, offered, planned, plannedLabel }: { need: number; offered: number; planned: number; plannedLabel: string }) {
  const state = coverageState(need, offered);
  return (
    <td className="py-1.5">
      <span className={`chip ${STYLE[state]}`}>{need > 0 ? `${offered} / ${need}` : '–'}</span>
      {planned > 0 && <span className="ml-2 text-xs text-charcoal-muted">{planned} {plannedLabel}</span>}
    </td>
  );
}

function Kpi({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-charcoal-muted">{label}</div>
      <div className="text-xl font-bold text-navy">{value}</div>
      {hint && <div className={`text-xs ${bad ? 'font-semibold text-brand-600' : 'text-charcoal-muted'}`}>{hint}</div>}
    </div>
  );
}
