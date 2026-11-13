import Link from 'next/link';
import { headers } from 'next/headers';
import { formatTime, mondayOf, addDays, stationsOf, ROSTER_SITES, isFrozen, firstPlannableWeek } from '@/domain/roster';
import { isPlanner } from '@/domain/roles';
import { formatDay, todayIso } from '@/lib/dates';
import { withBase } from '@/lib/base-path';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getProfile, getWeekView, listMyShifts, listTeam, sitesFor } from '@/server/services/roster-service';
import { listGaps } from '@/server/services/suggest-service';
import { whatsappLink, whatsappNumber } from '@/lib/whatsapp';
import { weekdayShort } from '@/domain/roster';
import { GapPanel } from './GapPanel';
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
  const planner = isPlanner(p);
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
  // The Leitung opens the first week that can still be planned (next week); staff see the current week
  const week = mondayOf(params.woche && /^\d{4}-\d{2}-\d{2}$/.test(params.woche) ? params.woche : planner ? firstPlannableWeek(today) : today);
  const view = await getWeekView(database, p, site.id, week);
  const mine = profile ? await listMyShifts(database, p, today, addDays(today, 14)) : [];
  const frozen = isFrozen(week, today); // the current and past weeks are planned already
  const gaps = planner && !view.hidden && !frozen ? await listGaps(database, p, site.id, week) : [];
  // WhatsApp: the whole week to a group, or one message per person with their own shifts
  let whatsapp: { group: string; people: { id: string; name: string; link: string; hasNumber: boolean }[] } | null = null;
  if (planner && !view.hidden && view.status === 'PUBLISHED' && !frozen) {
    const host = (await headers()).get('host');
    const url = host ? `https://${host}/dienstplan?site=${site.id}&woche=${week}` : '';
    const team = await listTeam(database, site.id);
    const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;
    const head = `AsiaWay Dienstplan ${site.name}, Woche ab ${dm(week)}`;
    whatsapp = {
      group: whatsappLink(`${head} ist veröffentlicht. Bitte in der App ansehen: ${url}`),
      people: team
        .map((m) => {
          const mine = view.shifts.filter((s) => s.userId === m.userId).sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
          const lines = mine.map((s) => `${weekdayShort(s.date, 'de')} ${dm(s.date)} ${formatTime(s.startMin)}–${formatTime(s.endMin)}`);
          const text = `Hallo ${m.name}, ${head}:\n${lines.join('\n')}\nÄnderung nötig? Bitte in der App anfragen: ${url}`;
          return { id: m.userId, name: m.name, count: mine.length, number: whatsappNumber(m.phone), text };
        })
        .filter((x) => x.count > 0)
        .map((x) => ({ id: x.id, name: x.name, link: whatsappLink(x.text, x.number), hasNumber: x.number !== null })),
    };
  }
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
            <Link href="/dienstplan/bedarf" className="btn-secondary min-h-0 px-3 py-1.5 text-sm">
              {t('Bedarf')}
            </Link>
          )}
          {planner && (
            <Link href="/dienstplan/uebersicht" className="btn-secondary min-h-0 px-3 py-1.5 text-sm">
              {t('Übersicht')}
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
            editable={planner && !frozen}
          />
          {planner && frozen && <p className="rounded-btn bg-navy-50 p-3 text-sm text-navy">{t('Diese Woche ist gesperrt: sie ist schon geplant. Geplant wird ab der nächsten Woche.')}</p>}
          {planner && !frozen && <GapPanel site={site.id} gaps={gaps} />}
          {whatsapp && (
            <details className="card">
              <summary className="cursor-pointer text-lg font-semibold text-navy">{t('Per WhatsApp mitteilen')}</summary>
              <p className="mt-2 text-sm text-charcoal-muted">{t('Ein Tipp öffnet WhatsApp mit dem fertigen Text. Mit Handynummer (Team & Meldungen) geht es direkt an die Person.')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={whatsapp.group} target="_blank" rel="noreferrer" className="btn-primary min-h-0 px-3 py-1.5 text-sm">{t('An die Gruppe')}</a>
                {whatsapp.people.map((x) => (
                  <a key={x.id} href={x.link} target="_blank" rel="noreferrer" className="chip bg-white px-3 py-1.5 text-charcoal ring-1 ring-surface-line">
                    {x.name}{x.hasNumber ? '' : ` (${t('Nummer fehlt')})`}
                  </a>
                ))}
              </div>
            </details>
          )}
          <a href={withBase(`/dienstplan/pdf?site=${site.id}&woche=${week}`)} target="_blank" rel="noreferrer" className="btn-secondary">
            {t('Plan als PDF (2 Seiten)')}
          </a>
        </>
      )}
    </div>
  );
}
