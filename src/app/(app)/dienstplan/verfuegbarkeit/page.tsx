import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ABSENCE_LABEL, dueMonth, firstOpenDate, monthDates, shiftMonth } from '@/domain/roster';
import { isOrderer } from '@/domain/roles';
import { formatDay, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getAvailabilityMonth, getProfile, listTeam } from '@/server/services/roster-service';
import { AvailabilityEditor } from './AvailabilityEditor';
import { VacationPanel } from './VacationPanel';

export const metadata = { title: 'Verfügbarkeit & Ferien' };

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ monat?: string; person?: string }> }) {
  const p = await requirePrincipal();
  const params = await searchParams;
  const database = await db();
  const planner = isOrderer(p);
  const today = todayIso();

  // The planner may open a colleague's page to enter their wishes.
  let userId = p.userId;
  if (params.person && params.person !== p.userId) {
    if (!planner) notFound();
    userId = params.person;
  }
  const profile = await getProfile(database, userId);
  if (!profile) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <h1 className="text-2xl">Verfügbarkeit & Ferien</h1>
        <p className="card">Sie sind noch keinem Team zugeordnet. Bitte bei der Leitung melden.</p>
      </div>
    );
  }
  const team = await listTeam(database, profile.site, { includeInactive: true });
  const person = team.find((t) => t.userId === userId);
  const month = params.monat && /^\d{4}-\d{2}$/.test(params.monat) ? params.monat : dueMonth(today);
  const data = await getAvailabilityMonth(database, p, userId, month);
  const dates = monthDates(month);
  const absentDates: Record<string, string> = {};
  for (const a of data.absences) {
    if (a.status === 'REJECTED') continue;
    for (const d of dates) if (a.startDate <= d && d <= a.endDate) absentDates[d] = a.status === 'REQUESTED' ? `${ABSENCE_LABEL[a.type]} (angefragt)` : ABSENCE_LABEL[a.type];
  }
  const own = userId === p.userId;
  const href = (m: string) => `/dienstplan/verfuegbarkeit?monat=${m}${own ? '' : `&person=${userId}`}`;
  const firstOpen = firstOpenDate(today);

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">← Dienstplan</Link>
        <h1 className="mt-1 text-2xl">Verfügbarkeit & Ferien</h1>
        {!own && <p className="text-charcoal-muted">für {person?.name}</p>}
      </div>

      <div className="rounded-btn bg-navy p-4 text-white">
        <div className="font-semibold">Bitte einen Monat im Voraus melden.</div>
        <p className="text-sm text-white/80">
          Änderungen sind ab {formatDay(firstOpen)} möglich. Für den {monthName(dueMonth(today))} ist jetzt die Meldung fällig.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Link href={href(shiftMonth(month, -1))} className="btn-secondary px-3" aria-label="Vormonat">←</Link>
        <div className="font-semibold text-navy">{monthName(month)}</div>
        <Link href={href(shiftMonth(month, 1))} className="btn-secondary px-3" aria-label="Folgemonat">→</Link>
      </div>

      <AvailabilityEditor
        key={`${userId}-${month}`}
        userId={userId}
        month={month}
        dates={dates}
        today={today}
        onCall={profile.employmentType === 'ON_CALL'}
        isPlanner={planner}
        days={data.days}
        absentDates={absentDates}
        submittedAt={data.submittedAt ? data.submittedAt.toISOString() : null}
        isSelf={own}
      />

      <VacationPanel
        userId={userId}
        isPlanner={planner}
        minDate={firstOpen}
        items={data.absences.map((a) => ({ id: a.id, startDate: a.startDate, endDate: a.endDate, type: a.type, status: a.status, note: a.note }))}
      />
    </div>
  );
}
