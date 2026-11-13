import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ABSENCE_LABEL, dueMonth, firstOpenDate, monthDates, shiftMonth } from '@/domain/roster';
import { isOrderer } from '@/domain/roles';
import { formatDay, monthLabel, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getAvailabilityMonth, getProfile, listTeam } from '@/server/services/roster-service';
import { getVacationBalance } from '@/server/services/hours-service';
import { AvailabilityEditor } from './AvailabilityEditor';
import { VacationPanel } from './VacationPanel';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Verfügbarkeit & Ferien') };
}

const monthName = (m: string, lang: 'de' | 'en') => monthLabel(m, lang);

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ monat?: string; person?: string }> }) {
  const t = await getT();
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
        <h1 className="text-2xl">{t('Verfügbarkeit & Ferien')}</h1>
        <p className="card">{t('Sie sind noch keinem Team zugeordnet. Bitte bei der Leitung melden.')}</p>
      </div>
    );
  }
  const team = await listTeam(database, profile.site, { includeInactive: true });
  const person = team.find((t) => t.userId === userId);
  const month = params.monat && /^\d{4}-\d{2}$/.test(params.monat) ? params.monat : dueMonth(today);
  const data = await getAvailabilityMonth(database, p, userId, month);
  const vacation = await getVacationBalance(database, p, userId, Number(month.slice(0, 4)));
  const dates = monthDates(month);
  const absentDates: Record<string, string> = {};
  for (const a of data.absences) {
    if (a.status === 'REJECTED') continue;
    for (const d of dates) if (a.startDate <= d && d <= a.endDate) absentDates[d] = a.status === 'REQUESTED' ? `${t(ABSENCE_LABEL[a.type])} (angefragt)` : t(ABSENCE_LABEL[a.type]);
  }
  const own = userId === p.userId;
  const href = (m: string) => `/dienstplan/verfuegbarkeit?monat=${m}${own ? '' : `&person=${userId}`}`;
  const firstOpen = firstOpenDate(today);

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">{t('← Dienstplan')}</Link>
        <h1 className="mt-1 text-2xl">{t('Verfügbarkeit & Ferien')}</h1>
        {!own && <p className="text-charcoal-muted">{t('für')} {person?.name}</p>}
      </div>

      <div className="rounded-btn bg-navy p-4 text-white">
        <div className="font-semibold">{t('Bitte einen Monat im Voraus melden.')}</div>
        <p className="text-sm text-white/80">
          {t('Änderungen sind ab {date} möglich. Für den {month} ist jetzt die Meldung fällig.', { date: formatDay(firstOpen, t.lang), month: monthName(dueMonth(today), t.lang) })}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Link href={href(shiftMonth(month, -1))} className="btn-secondary px-3" aria-label={t('Vormonat')}>←</Link>
        <div className="font-semibold text-navy">{monthName(month, t.lang)}</div>
        <Link href={href(shiftMonth(month, 1))} className="btn-secondary px-3" aria-label={t('Folgemonat')}>→</Link>
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

      <div className="card flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{t('Ferien')} {vacation.year}: <strong>{vacation.remaining} {t('Tage Rest')}</strong> {t('von')} {vacation.entitlement + vacation.carry} {t('(genommen')} {vacation.taken}{t(', angefragt')} {vacation.requested})</span>
        <Link href={own ? '/dienstplan/stunden' : `/dienstplan/stunden?person=${userId}`} className="text-brand-600 underline">{t('Meine Stunden')}</Link>
      </div>

      <VacationPanel
        userId={userId}
        isPlanner={planner}
        minDate={firstOpen}
        items={data.absences.map((a) => ({ id: a.id, startDate: a.startDate, endDate: a.endDate, type: a.type, status: a.status, note: a.note }))}
      />
    </div>
  );
}
