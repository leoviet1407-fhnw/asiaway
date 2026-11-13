import Link from 'next/link';
import { formatTime, mondayOf, addDays, stationsOf, ROSTER_SITES } from '@/domain/roster';
import { isOrderer } from '@/domain/roles';
import { formatDay, todayIso } from '@/lib/dates';
import { withBase } from '@/lib/base-path';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getProfile, getWeekView, listMyShifts, sitesFor } from '@/server/services/roster-service';
import { WeekPlanner } from './WeekPlanner';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Dienstplan') };
}

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ site?: string; woche?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  const params = await searchParams;
  const database = await db();
  const sites = await sitesFor(database, p);
  const planner = isOrderer(p);
  const profile = await getProfile(database, p.userId);

  if (sites.length === 0) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <h1 className="text-2xl">{t('Dienstplan')}</h1>
        <p className="card">{t('Sie sind noch keinem Team zugeordnet. Bitte bei der Leitung melden.')}</p>
      </div>
    );
  }
  const site = sites.find((s) => s.id === params.site) ?? sites.find((s) => s.id === profile?.site) ?? sites[0]!;
  const today = todayIso();
  const week = mondayOf(params.woche && /^\d{4}-\d{2}-\d{2}$/.test(params.woche) ? params.woche : today);
  const view = await getWeekView(database, p, site.id, week);
  const mine = profile ? await listMyShifts(database, p, today, addDays(today, 14)) : [];
  const href = (w: string, s = site.id) => `/dienstplan?site=${s}&woche=${w}`;
  const station = (s: string) => stationsOf(site.id).find((x) => x.name === s);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">{t('Dienstplan')}</h1>
        <div className="flex flex-wrap gap-2">
          {profile && (
            <Link href="/dienstplan/verfuegbarkeit" className="btn-secondary min-h-0 px-3 py-1.5 text-sm">
              {t('Verfügbarkeit & Ferien')}
            </Link>
          )}
          {profile && (
            <Link href="/dienstplan/stunden" className="btn-secondary min-h-0 px-3 py-1.5 text-sm">
              {t('Meine Stunden')}
            </Link>
          )}
          {planner && (
            <Link href="/dienstplan/team" className="btn-secondary min-h-0 px-3 py-1.5 text-sm">
              {t('Team & Meldungen')}
            </Link>
          )}
        </div>
      </div>

      {mine.length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-lg">{t('Meine nächsten Schichten')}</h2>
          <ul className="divide-y divide-surface-line">
            {mine.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="font-medium text-navy">{formatDay(s.date, t.lang)}</span>
                <span className="rounded px-2 py-0.5 text-sm font-semibold" style={{ background: station(s.station)?.color ?? '#e3e1df', color: station(s.station)?.textColor ?? '#09141d' }}>
                  {formatTime(s.startMin)}–{formatTime(s.endMin)} · {s.roleLabel ?? s.station}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {planner && ROSTER_SITES.length > 1 && (
        <div className="flex gap-2">
          {sites.map((s) => (
            <Link key={s.id} href={href(week, s.id)} className={`chip px-3 py-1 ${s.id === site.id ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>
              {s.name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Link href={href(addDays(week, -7))} className="btn-secondary px-3" aria-label={t('Vorwoche')}>←</Link>
        <div className="text-center">
          <div className="font-semibold text-navy">{t('Woche ab')} {formatDay(week, t.lang)}</div>
          <div className="text-xs text-charcoal-muted">{site.name}</div>
        </div>
        <Link href={href(addDays(week, 7))} className="btn-secondary px-3" aria-label={t('Folgewoche')}>→</Link>
      </div>

      {view.hidden ? (
        <p className="card text-charcoal-muted">{t('Diese Woche ist noch nicht veröffentlicht.')}</p>
      ) : (
        <>
          <WeekPlanner
            site={site.id}
            weekStart={week}
            status={view.status}
            people={view.people}
            shifts={view.shifts}
            availability={view.availability}
            absences={view.absences}
            violations={view.violations}
            editable={planner}
          />
          <a href={withBase(`/dienstplan/pdf?site=${site.id}&woche=${week}`)} target="_blank" rel="noreferrer" className="btn-secondary">
            {t('Plan als PDF (2 Seiten)')}
          </a>
        </>
      )}
    </div>
  );
}
