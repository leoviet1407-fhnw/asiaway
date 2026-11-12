import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ABSENCE_LABEL, EMPLOYMENT_LABEL, ROSTER_SITES, dueMonth, firstOpenDate, shiftMonth } from '@/domain/roster';
import { isAdmin, isOrderer } from '@/domain/roles';
import { formatDateTime, formatDay, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listPendingAbsences, listTeam, submissionOverview } from '@/server/services/roster-service';
import { AbsenceDecision, NewMemberForm, ProfileForm } from './TeamForms';

export const metadata = { title: 'Team & Meldungen' };

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ site?: string; monat?: string }> }) {
  const p = await requirePrincipal();
  if (!isOrderer(p)) redirect('/dienstplan');
  const params = await searchParams;
  const database = await db();
  const site = ROSTER_SITES.find((s) => s.id === params.site) ?? ROSTER_SITES[1]!;
  const today = todayIso();
  const month = params.monat && /^\d{4}-\d{2}$/.test(params.monat) ? params.monat : dueMonth(today);
  const [overview, pending, team] = await Promise.all([
    submissionOverview(database, p, site.id, month),
    listPendingAbsences(database, p, site.id),
    listTeam(database, site.id, { includeInactive: true }),
  ]);
  const href = (m: string, s = site.id) => `/dienstplan/team?site=${s}&monat=${m}`;
  const missing = overview.filter((o) => !o.submittedAt).length;

  return (
    <div className="space-y-6 pb-8">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">← Dienstplan</Link>
        <h1 className="mt-1 text-2xl">Team & Meldungen</h1>
      </div>
      <div className="flex gap-2">
        {ROSTER_SITES.map((s) => (
          <Link key={s.id} href={href(month, s.id)} className={`chip px-3 py-1 ${s.id === site.id ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{s.name}</Link>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="h-site">Meldungen für {monthName(month)}</h2>
        <div className="flex items-center justify-between gap-2">
          <Link href={href(shiftMonth(month, -1))} className="btn-secondary px-3" aria-label="Vormonat">←</Link>
          <span className="text-center text-sm text-charcoal-muted">Mitarbeiter können Tage ab {formatDay(firstOpenDate(today))} ändern</span>
          <Link href={href(shiftMonth(month, 1))} className="btn-secondary px-3" aria-label="Folgemonat">→</Link>
        </div>
        {overview.length === 0 ? (
          <p className="card text-charcoal-muted">Noch niemand im Team. Unten Mitarbeiter hinzufügen.</p>
        ) : (
          <>
            <p className={`rounded-btn p-3 text-sm font-semibold ${missing === 0 ? 'bg-ok-50 text-ok-500' : 'bg-warn-50 text-warn-500'}`}>
              {missing === 0 ? 'Alle haben gemeldet.' : `${missing} von ${overview.length} haben noch nicht gemeldet.`}
            </p>
            <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
              {overview.map((o) => (
                <li key={o.person.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <div className="font-semibold text-navy">{o.person.name}</div>
                    <div className="text-xs text-charcoal-muted">
                      {o.person.pensumPercent ? `${o.person.pensumPercent} %` : EMPLOYMENT_LABEL[o.person.employmentType]} · {o.availableDays} verfügbar · {o.unavailableDays} nicht verfügbar
                      {o.absences.length > 0 && ` · ${o.absences.map((a) => `${ABSENCE_LABEL[a.type]} ${formatDay(a.startDate).slice(4, 10)}${a.startDate !== a.endDate ? '–' + formatDay(a.endDate).slice(4, 10) : ''}`).join(', ')}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.submittedAt ? <span className="chip bg-ok-50 text-ok-500">✓ {formatDateTime(o.submittedAt).slice(0, 10)}</span> : <span className="chip bg-warn-50 text-warn-500">fehlt</span>}
                    <Link href={`/dienstplan/verfuegbarkeit?monat=${month}&person=${o.person.userId}`} className="btn-ghost min-h-0 px-2 py-1 text-sm">öffnen</Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="h-site">Ferienanfragen <span className="chip ml-1 bg-navy-50 text-navy">{pending.length}</span></h2>
        {pending.length === 0 ? (
          <p className="card text-sm text-charcoal-muted">Keine offenen Anfragen.</p>
        ) : (
          <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
            {pending.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <div className="font-semibold text-navy">{a.name}</div>
                  <div className="text-sm">{formatDay(a.startDate)}{a.endDate !== a.startDate && ` – ${formatDay(a.endDate)}`} · {ABSENCE_LABEL[a.type]}</div>
                </div>
                <AbsenceDecision id={a.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="h-site">Team {site.name}</h2>
        <ul className="space-y-3">
          {team.map((m) => (
            <li key={m.userId} className="card">
              <ProfileForm member={m} />
            </li>
          ))}
        </ul>
        {isAdmin(p) ? <NewMemberForm site={site.id} /> : <p className="text-sm text-charcoal-muted">Neue Mitarbeiter legt ein Admin an.</p>}
      </section>
    </div>
  );
}
