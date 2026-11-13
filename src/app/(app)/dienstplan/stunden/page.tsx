import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatOvertime, formatWorked } from '@/domain/hours';
import { isPlanner } from '@/domain/roles';
import { shiftMonth } from '@/domain/roster';
import { formatDay, monthLabel, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getMonthHours, getVacationBalance } from '@/server/services/hours-service';
import { getProfile, listTeam } from '@/server/services/roster-service';
import { HoursEditor } from './HoursEditor';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Meine Stunden') };
}

const monthName = (m: string, lang: 'de' | 'en') => monthLabel(m, lang);

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ monat?: string; person?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  const params = await searchParams;
  const database = await db();
  const planner = isPlanner(p);
  const today = todayIso();

  let userId = p.userId;
  if (params.person && params.person !== p.userId) {
    if (!planner) notFound();
    userId = params.person;
  }
  const profile = await getProfile(database, userId);
  if (!profile) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <h1 className="text-2xl">{t('Meine Stunden')}</h1>
        <p className="card">{t('Sie sind noch keinem Team zugeordnet. Bitte bei der Leitung melden.')}</p>
      </div>
    );
  }
  const month = params.monat && /^\d{4}-\d{2}$/.test(params.monat) ? params.monat : today.slice(0, 7);
  const [data, vacation, team] = await Promise.all([
    getMonthHours(database, p, userId, month),
    getVacationBalance(database, p, userId, Number(month.slice(0, 4))),
    listTeam(database, profile.site, { includeInactive: true }),
  ]);
  const person = team.find((t) => t.userId === userId);
  const own = userId === p.userId;
  const href = (m: string) => `/dienstplan/stunden?monat=${m}${own ? '' : `&person=${userId}`}`;
  const tot = data.totals;
  const hasTarget = tot.targetMinutes !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">{t('← Dienstplan')}</Link>
        <h1 className="mt-1 text-2xl">{t('Meine Stunden')}</h1>
        {!own && <p className="text-charcoal-muted">{person?.name}</p>}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Link href={href(shiftMonth(month, -1))} className="btn-secondary px-3" aria-label={t('Vormonat')}>←</Link>
        <div className="font-semibold text-navy">{monthName(month, t.lang)}</div>
        <Link href={href(shiftMonth(month, 1))} className="btn-secondary px-3" aria-label={t('Folgemonat')}>→</Link>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('Gearbeitet')} value={formatWorked(tot.workedMinutes)} />
        <Stat label={t('Ferien/Krank angerechnet')} value={formatWorked(tot.creditMinutes)} hint={tot.creditDays ? `${tot.creditDays} Tage` : undefined} />
        <Stat label={t('Soll')} value={hasTarget ? formatWorked(tot.targetMinutes!) : '–'} hint={profile.pensumPercent ? `${profile.pensumPercent} %` : t('kein Pensum')} />
        <Stat
          label={t('Überstunden Monat')}
          value={tot.overtimeMinutes === null ? '–' : formatOvertime(tot.overtimeMinutes)}
          tone={tot.overtimeMinutes === null ? undefined : tot.overtimeMinutes > 0 ? 'plus' : tot.overtimeMinutes < 0 ? 'minus' : undefined}
        />
      </section>
      {data.yearBalanceMinutes !== null && (
        <p className="rounded-btn bg-navy p-3 text-sm text-white">
          {t('Überstunden-Saldo')} {month.slice(0, 4)} {t('(freigegebene Monate):')} <strong>{formatOvertime(data.yearBalanceMinutes)}</strong>
          {data.approved ? '' : ` – ${t('dieser Monat zählt nach der Freigabe')}`}
        </p>
      )}
      {!hasTarget && <p className="text-sm text-charcoal-muted">{t('Aushilfe und Geschäftsleitung haben kein Pensum: Es werden nur die Stunden gezählt, keine Überstunden.')}</p>}
      {data.approved && <p className="rounded-btn bg-ok-50 p-3 text-sm font-semibold text-ok-500">{t('Freigegeben am')} {formatDay(data.approvedAt!.toISOString().slice(0, 10))}</p>}

      <section className="card">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h2 className="text-lg">{t('Ferien')} {vacation.year}</h2>
          <Link href={own ? '/dienstplan/verfuegbarkeit' : `/dienstplan/verfuegbarkeit?person=${userId}`} className="text-sm text-brand-600 underline">{t('Ferien anfragen')}</Link>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center text-sm">
          <Mini label={t('Anspruch')} value={String(vacation.entitlement + vacation.carry)} />
          <Mini label={t('Genommen')} value={String(vacation.taken)} />
          <Mini label={t('Angefragt')} value={String(vacation.requested)} />
          <Mini label={t('Rest')} value={String(vacation.remaining)} bad={vacation.remaining < 0} />
        </div>
        {vacation.remaining < 0 && <p className="mt-2 text-sm text-brand-600">{t('Mehr Ferientage angefragt als vorhanden.')}</p>}
        <p className="mt-1 text-xs text-charcoal-muted">{t('Gezählt werden Arbeitstage Mo–Fr (Wochenenden zählen nicht).')}</p>
      </section>

      <HoursEditor
        key={`${userId}-${month}-${data.entries.length}-${data.approved}`}
        userId={userId}
        month={month}
        today={today}
        planned={data.planned}
        entries={data.entries}
        approved={data.approved}
        isPlanner={planner}
        isSelf={own}
      />
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string | undefined; tone?: 'plus' | 'minus' | undefined }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-charcoal-muted">{label}</div>
      <div className={`text-lg font-bold ${tone === 'plus' ? 'text-ok-500' : tone === 'minus' ? 'text-brand-600' : 'text-navy'}`}>{value}</div>
      {hint && <div className="text-xs text-charcoal-muted">{hint}</div>}
    </div>
  );
}

function Mini({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-xs text-charcoal-muted">{label}</div>
      <div className={`text-xl font-bold ${bad ? 'text-brand-600' : 'text-navy'}`}>{value}</div>
    </div>
  );
}
