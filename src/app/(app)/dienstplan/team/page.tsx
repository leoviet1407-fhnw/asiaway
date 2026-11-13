import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ABSENCE_LABEL, EMPLOYMENT_LABEL, ROSTER_SITES, dueMonth, mustReportTimes, shiftMonth, stationsOf } from '@/domain/roster';
import { isAdmin, isPlanner } from '@/domain/roles';
import { formatDateTime, formatDay, monthLabel, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listPendingAbsences, listTeam, submissionOverview } from '@/server/services/roster-service';
import { AbsenceDecision, BalanceForm, NewMemberForm, ProfileForm } from './TeamForms';
import { formatOvertime, vacationNeedsAttention } from '@/domain/hours';
import { getSiteDays } from '@/server/services/pattern-service';
import { getYearlyBalance, teamBalances } from '@/server/services/hours-service';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Team & Meldungen') };
}

const monthName = (m: string, lang: 'de' | 'en') => monthLabel(m, lang);

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ site?: string; monat?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  if (!isPlanner(p)) redirect('/dienstplan');
  const params = await searchParams;
  const database = await db();
  const site = ROSTER_SITES.find((s) => s.id === params.site) ?? ROSTER_SITES[1]!;
  const today = todayIso();
  const month = params.monat && /^\d{4}-\d{2}$/.test(params.monat) ? params.monat : dueMonth(today);
  const year = Number(today.slice(0, 4));
  const [balances, overview, pending, team] = await Promise.all([
    teamBalances(database, p, site.id, today.slice(0, 7), today),
    submissionOverview(database, p, site.id, month),
    listPendingAbsences(database, p, site.id),
    listTeam(database, site.id, { includeInactive: true }),
  ]);
  const siteDaysMap = await getSiteDays(database, team.map((m) => m.userId));
  const yearly = await Promise.all(team.map((m) => getYearlyBalance(database, m.userId, year)));
  const href = (m: string, s = site.id) => `/dienstplan/team?site=${s}&monat=${m}`;
  // Only casual staff report the times they can work; people with a Pensum enter holiday only
  const reporting = overview.filter((o) => mustReportTimes(o.person.employmentType));
  const missing = reporting.filter((o) => !o.submittedAt && !o.hasPattern).length;

  return (
    <div className="space-y-6 pb-8">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">{t('← Dienstplan')}</Link>
        <h1 className="mt-1 text-2xl">{t('Team & Meldungen')}</h1>
      </div>
      <div className="flex gap-2">
        {ROSTER_SITES.map((s) => (
          <Link key={s.id} href={href(month, s.id)} className={`chip px-3 py-1 ${s.id === site.id ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{s.name}</Link>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="h-site">{t('Meldungen für')} {monthName(month, t.lang)}</h2>
        <div className="flex items-center justify-between gap-2">
          <Link href={href(shiftMonth(month, -1))} className="btn-secondary px-3" aria-label={t('Vormonat')}>←</Link>
          <span className="text-center text-sm text-charcoal-muted">{t('Mitarbeiter können jederzeit eintragen und ändern.')}</span>
          <Link href={href(shiftMonth(month, 1))} className="btn-secondary px-3" aria-label={t('Folgemonat')}>→</Link>
        </div>
        {reporting.length === 0 ? (
          <p className="card text-charcoal-muted">{t('Nur Aushilfen melden ihre Zeiten. Im Team gibt es noch keine.')}</p>
        ) : (
          <>
            <p className={`rounded-btn p-3 text-sm font-semibold ${missing === 0 ? 'bg-ok-50 text-ok-500' : 'bg-warn-50 text-warn-500'}`}>
              {missing === 0 ? t('Alle haben gemeldet.') : t('{missing} von {total} haben noch nicht gemeldet.', { missing, total: reporting.length })}
            </p>
            <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
              {reporting.map((o) => (
                <li key={o.person.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <div className="font-semibold text-navy">{o.person.name}</div>
                    <div className="text-xs text-charcoal-muted">
                      {o.person.pensumPercent ? `${o.person.pensumPercent} %` : t(EMPLOYMENT_LABEL[o.person.employmentType])} · {o.availableDays} {t('verfügbar ·')} {o.unavailableDays} {t('nicht verfügbar')}
                      {o.absences.length > 0 && ` · ${o.absences.map((a) => `${t(ABSENCE_LABEL[a.type])} ${formatDay(a.startDate, t.lang).slice(4, 10)}${a.startDate !== a.endDate ? '–' + formatDay(a.endDate, t.lang).slice(4, 10) : ''}`).join(', ')}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.submittedAt ? <span className="chip bg-ok-50 text-ok-500">✓ {formatDateTime(o.submittedAt).slice(0, 10)}</span> : o.hasPattern ? <span className="chip bg-ok-50 text-ok-500">✓ {t('Standardwoche')}</span> : <span className="chip bg-warn-50 text-warn-500">{t('fehlt')}</span>}
                    <Link href={`/dienstplan/verfuegbarkeit?monat=${month}&person=${o.person.userId}`} className="btn-ghost min-h-0 px-2 py-1 text-sm">{t('öffnen')}</Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="h-site">{t('Ferienanfragen')} <span className="chip ml-1 bg-navy-50 text-navy">{pending.length}</span></h2>
        {pending.length === 0 ? (
          <p className="card text-sm text-charcoal-muted">{t('Keine offenen Anfragen.')}</p>
        ) : (
          <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
            {pending.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <div className="font-semibold text-navy">{a.name}</div>
                  <div className="text-sm">{formatDay(a.startDate, t.lang)}{a.endDate !== a.startDate && ` – ${formatDay(a.endDate, t.lang)}`} · {t(ABSENCE_LABEL[a.type])}</div>
                </div>
                <AbsenceDecision id={a.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="h-site">{t('Ferien & Überstunden')}</h2>
        <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
          {balances.map(({ person, vacation, hours }) => (
            <li key={person.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <div className="font-semibold text-navy">{person.name}</div>
                <div className="text-xs text-charcoal-muted">
                  {t('Ferien:')} {vacation.taken} {t('genommen ·')} {vacation.requested} {t('angefragt ·')} <span className={vacation.remaining < 0 || vacationNeedsAttention(vacation, today) ? 'font-bold text-brand-600' : ''}>{t('Rest')} {vacation.remaining}</span> {t('von')} {vacation.entitlement + vacation.carry}
                  {vacationNeedsAttention(vacation, today) && ` – ${t('noch viel offen')}`}
                </div>
                <div className="text-xs text-charcoal-muted">
                  {hours.totals.overtimeMinutes === null ? `${t('Stunden diesen Monat')}: ${Math.round(hours.totals.workedMinutes / 60)} h` : `${t('Überstunden Monat')}: ${formatOvertime(hours.totals.overtimeMinutes)} · ${t('Saldo')} ${formatOvertime(hours.yearBalanceMinutes ?? 0)}`}
                </div>
              </div>
              <Link href={`/dienstplan/stunden?person=${person.userId}`} className="btn-secondary min-h-0 px-3 py-1.5 text-sm">{t('Stunden prüfen')}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="h-site">{t('Team')} {site.name}</h2>
        <ul className="space-y-3">
          {team.map((m, i) => (
            <li key={m.userId} className="card space-y-3">
              <ProfileForm member={{ ...m, stations: stationsOf(m.site).map((s) => s.name), siteDays: Object.fromEntries(siteDaysMap.get(m.userId) ?? []) }} />
              <BalanceForm userId={m.userId} year={year} vacationDays={yearly[i]!.vacationDays} vacationCarry={yearly[i]!.vacationCarry} overtimeCarryHours={yearly[i]!.overtimeCarryMin / 60} />
            </li>
          ))}
        </ul>
        {isAdmin(p) ? <NewMemberForm site={site.id} /> : <p className="text-sm text-charcoal-muted">{t('Neue Mitarbeiter legt ein Admin an.')}</p>}
      </section>
    </div>
  );
}

