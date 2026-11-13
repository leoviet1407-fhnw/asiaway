import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatOvertime, formatWorked } from '@/domain/hours';
import { isPlanner, roleLabel } from '@/domain/roles';
import { EMPLOYMENT_LABEL, ROSTER_SITES, addDays, mondayOf, shiftMonth, weekdayShort } from '@/domain/roster';
import { formatChf } from '@/domain/qty';
import { getT } from '@/i18n/server';
import { formatDay, monthLabel, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getOverview } from '@/server/services/overview-service';
import { ColumnChart, DivergingBars, HBarChart, StackedBars } from '@/components/charts';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Übersicht') };
}

const NAVY = '#09141d';
const WARN = '#c98a00';
const OK = '#1f6b3a';

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ site?: string; monat?: string; woche?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  if (!isPlanner(p)) redirect('/dienstplan');
  const params = await searchParams;
  const today = todayIso();
  const month = params.monat && /^\d{4}-\d{2}$/.test(params.monat) ? params.monat : today.slice(0, 7);
  const weekStart = mondayOf(params.woche && /^\d{4}-\d{2}-\d{2}$/.test(params.woche) ? params.woche : today);
  const site = ROSTER_SITES.find((s) => s.id === params.site);
  const data = await getOverview(await db(), p, { month, weekStart, siteId: site?.id, today });

  const href = (over: { site?: string | null; monat?: string; woche?: string }) => {
    const s = over.site === undefined ? site?.id : over.site;
    return `/dienstplan/uebersicht?${s ? `site=${s}&` : ''}monat=${over.monat ?? month}&woche=${over.woche ?? weekStart}`;
  };
  const active = data.staff.filter((s) => s.active);
  const h = (min: number) => `${(min / 60).toFixed(min % 60 === 0 ? 0 : 1)} h`;
  const planned = active.reduce((s, r) => s + r.plannedMinutes, 0);
  const worked = active.reduce((s, r) => s + r.workedMinutes, 0);
  const vacationLeft = active.reduce((s, r) => s + r.vacation.remaining, 0);
  const withTarget = active.filter((r) => r.targetMinutes !== null);
  const withBalance = active.filter((r) => r.overtimeBalanceMinutes !== null);

  return (
    <div className="space-y-6 pb-10">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">← {t('Dienstplan')}</Link>
        <h1 className="mt-1 text-2xl">{t('Übersicht')}</h1>
        <p className="text-charcoal-muted">{t('Das ganze Team, Stunden, Ferien, Überstunden und Umsatz auf einen Blick.')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ site: null })} className={`chip px-3 py-1 ${!site ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{t('Alle Standorte')}</Link>
        {ROSTER_SITES.map((s) => (
          <Link key={s.id} href={href({ site: s.id })} className={`chip px-3 py-1 ${site?.id === s.id ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{s.name}</Link>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <Link href={href({ monat: shiftMonth(month, -1) })} className="btn-secondary min-h-0 px-3 py-1" aria-label={t('Vormonat')}>←</Link>
          <span className="font-semibold capitalize text-navy">{monthLabel(month, t.lang)}</span>
          <Link href={href({ monat: shiftMonth(month, 1) })} className="btn-secondary min-h-0 px-3 py-1" aria-label={t('Folgemonat')}>→</Link>
        </span>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Kpi label={t('Mitarbeiter aktiv')} value={String(active.length)} hint={`${data.staff.length - active.length} ${t('inaktiv')}`} />
        <Kpi label={t('Geplante Stunden')} value={h(planned)} />
        <Kpi label={t('Gearbeitete Stunden')} value={h(worked)} />
        <Kpi label={t('Ferientage übrig')} value={String(vacationLeft)} />
        <Kpi label={t('Umsatz 30 Tage')} value={formatChf(data.sales.totalCents)} hint={`${data.sales.closings} ${t('Abschlüsse')}`} />
      </section>

      <section className="card space-y-3">
        <h2 className="h-site">{t('Stunden pro Person')}</h2>
        <p className="text-xs text-charcoal-muted">{t('Geplant im Monat, die Linie ist das Soll aus dem Pensum.')}</p>
        {active.length === 0 ? (
          <p className="text-sm text-charcoal-muted">{t('Noch niemand im Team.')}</p>
        ) : (
          <HBarChart
            ariaLabel={t('Stunden pro Person')}
            rows={active.map((r) => ({
              label: r.name,
              value: r.plannedMinutes / 60,
              target: r.targetMinutes === null ? null : r.targetMinutes / 60,
              text: r.targetMinutes === null ? h(r.plannedMinutes) : `${h(r.plannedMinutes)} / ${h(r.targetMinutes)}`,
              sub: r.workedMinutes > 0 ? `${t('gearbeitet')} ${h(r.workedMinutes)}` : undefined,
            }))}
          />
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="h-site">{t('Ferien')} {data.year}</h2>
          <StackedBars
            ariaLabel={t('Ferien')}
            legend={[
              { color: NAVY, label: t('Genommen') },
              { color: WARN, label: t('Angefragt') },
              { color: OK, label: t('Rest') },
            ]}
            rows={active.map((r) => ({
              label: r.name,
              text: `${r.vacation.remaining} ${t('Rest')} / ${r.vacation.entitlement + r.vacation.carry}`,
              segments: [
                { value: r.vacation.taken, color: NAVY, title: t('Genommen') },
                { value: r.vacation.requested, color: WARN, title: t('Angefragt') },
                { value: Math.max(0, r.vacation.remaining), color: OK, title: t('Rest') },
              ],
            }))}
          />
        </div>
        <div className="card space-y-3">
          <h2 className="h-site">{t('Überstunden-Saldo')} {data.year}</h2>
          <p className="text-xs text-charcoal-muted">{t('Freigegebene Monate plus Übertrag. Nur Mitarbeiter mit Pensum.')}</p>
          {withBalance.length === 0 ? (
            <p className="text-sm text-charcoal-muted">{t('Noch keine freigegebenen Monate.')}</p>
          ) : (
            <DivergingBars
              ariaLabel={t('Überstunden-Saldo')}
              rows={withBalance.map((r) => ({ label: r.name, value: (r.overtimeBalanceMinutes ?? 0) / 60, text: formatOvertime(r.overtimeBalanceMinutes ?? 0) }))}
            />
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="h-site">{t('Besetzung pro Tag')}</h2>
            <span className="flex items-center gap-1 text-sm">
              <Link href={href({ woche: addDays(weekStart, -7) })} className="btn-secondary min-h-0 px-2 py-0.5" aria-label={t('Vorwoche')}>←</Link>
              <span className="text-xs text-charcoal-muted">{formatDay(weekStart, t.lang)}</span>
              <Link href={href({ woche: addDays(weekStart, 7) })} className="btn-secondary min-h-0 px-2 py-0.5" aria-label={t('Folgewoche')}>→</Link>
            </span>
          </div>
          <p className="text-xs text-charcoal-muted">{t('Geplante Arbeitsstunden pro Tag, darunter die Anzahl Personen.')}</p>
          <ColumnChart
            ariaLabel={t('Besetzung pro Tag')}
            color="#ac2025"
            items={data.week.days.map((d) => ({ label: weekdayShort(d.date, t.lang), value: d.hours, text: `${d.hours.toFixed(1)} h`, sub: `${d.people}`, highlight: d.date === today }))}
          />
        </div>
        <div className="card space-y-3">
          <h2 className="h-site">{t('Umsatz pro Tag')}</h2>
          <p className="text-xs text-charcoal-muted">{t('Kassen-Brutto laut Tagesabschluss, letzte 30 Tage.')}</p>
          {data.sales.closings === 0 ? (
            <p className="text-sm text-charcoal-muted">{t('Noch keine Tagesabschlüsse in den letzten 30 Tagen.')}</p>
          ) : (
            <>
              <ColumnChart
                ariaLabel={t('Umsatz pro Tag')}
                color="#09141d"
                showEvery={5}
                items={data.sales.days.map((d) => ({ label: d.date.slice(8), value: d.grossCents / 100, text: formatChf(d.grossCents), highlight: false }))}
              />
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <Mini label={t('Total')} value={formatChf(data.sales.totalCents)} />
                <Mini label={t('Ø pro Öffnungstag')} value={formatChf(data.sales.averageCents)} />
                <Mini label={t('Trinkgeld')} value={formatChf(data.sales.tipsCents)} />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="h-site">{t('Alle Mitarbeiter')}</h2>
        {data.staff.length === 0 ? (
          <p className="card text-sm text-charcoal-muted">{t('Noch niemand im Team.')}</p>
        ) : (
          <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
            {data.staff.map((r) => (
              <li key={r.userId} className="grid gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className={`font-semibold text-navy ${r.active ? '' : 'line-through opacity-60'}`}>{r.name}</div>
                  <div className="truncate text-xs text-charcoal-muted">{r.email}</div>
                  <div className="text-xs text-charcoal-muted">
                    {r.siteName} · {r.pensumPercent ? `${r.pensumPercent} %` : t(EMPLOYMENT_LABEL[r.employmentType])}
                    {r.roles.length > 0 && ` · ${r.roles.map((x) => t(roleLabel(x))).join(', ')}`}
                  </div>
                </div>
                <div className="text-xs text-charcoal-muted">
                  <div>{t('Geplant')} {formatWorked(r.plannedMinutes)}{r.targetMinutes !== null && ` / ${t('Soll')} ${formatWorked(r.targetMinutes)}`}</div>
                  <div>{t('Gearbeitet')} {formatWorked(r.workedMinutes)}</div>
                </div>
                <div className="text-xs text-charcoal-muted">
                  <div className={r.vacation.remaining < 0 ? 'font-bold text-brand-600' : ''}>{t('Ferien Rest')}: {r.vacation.remaining} / {r.vacation.entitlement + r.vacation.carry}</div>
                  <div>{t('Überstunden')}: {r.overtimeBalanceMinutes === null ? '–' : formatOvertime(r.overtimeBalanceMinutes)}</div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/dienstplan/stunden?person=${r.userId}`} className="btn-secondary min-h-0 px-3 py-1.5 text-sm">{t('Stunden')}</Link>
                  <Link href={`/dienstplan/verfuegbarkeit?person=${r.userId}`} className="btn-ghost min-h-0 px-2 py-1.5 text-sm">{t('Ferien')}</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-charcoal-muted">{withTarget.length} {t('Mitarbeiter mit Pensum')} · {data.staff.length - withTarget.length} {t('ohne Pensum (Aushilfe, Geschäftsleitung)')}</p>
      </section>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-charcoal-muted">{label}</div>
      <div className="text-xl font-bold text-navy">{value}</div>
      {hint && <div className="text-xs text-charcoal-muted">{hint}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-charcoal-muted">{label}</div>
      <div className="font-bold text-navy">{value}</div>
    </div>
  );
}
