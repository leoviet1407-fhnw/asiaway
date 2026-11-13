import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isPlanner } from '@/domain/roles';
import { ROSTER_SITES } from '@/domain/roster';
import { swissHolidays } from '@/domain/season';
import { formatDay, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listSpecialDays, listVacationRules } from '@/server/services/season-service';
import { getT } from '@/i18n/server';
import { SpecialDayForm, RuleForm, SpecialRow, RuleRow } from './Forms';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Feiertage & Ferienzeit') };
}

export default async function SeasonPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  if (!isPlanner(p)) redirect('/dienstplan');
  const params = await searchParams;
  const database = await db();
  const site = ROSTER_SITES.find((s) => s.id === params.site) ?? ROSTER_SITES.find((s) => s.id === 'winterthur')!;
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const [days, rules] = await Promise.all([listSpecialDays(database, site.id, today, `${year + 1}-12-31`), listVacationRules(database, site.id)]);
  const known = new Set(days.map((d) => d.date));
  const suggestions = [...swissHolidays(year), ...swissHolidays(year + 1)].filter((h) => h.date >= today && !known.has(h.date)).slice(0, 12);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">{t('← Dienstplan')}</Link>
        <h1 className="mt-1 text-2xl">{t('Feiertage & Ferienzeit')}</h1>
        <p className="text-charcoal-muted">{t('Besondere Tage haben ihren eigenen Bedarf. Ferien-Limiten verhindern, dass zu viele gleichzeitig frei nehmen.')}</p>
      </div>
      <div className="flex gap-2">
        {ROSTER_SITES.map((s) => (
          <Link key={s.id} href={`/dienstplan/saison?site=${s.id}`} className={`chip px-3 py-1 ${s.id === site.id ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{s.name}</Link>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="h-site">{t('Besondere Tage')}</h2>
        {days.length === 0 ? (
          <p className="card text-sm text-charcoal-muted">{t('Noch keine besonderen Tage. Unten Feiertage übernehmen oder einen Tag hinzufügen.')}</p>
        ) : (
          <ul className="space-y-2">
            {days.map((d) => (
              <SpecialRow key={d.date} site={site.id} date={d.date} dateText={formatDay(d.date, t.lang)} label={d.label} closed={d.closed} lunch={d.lunchPeople} dinner={d.dinnerPeople} />
            ))}
          </ul>
        )}
        <SpecialDayForm site={site.id} suggestions={suggestions.map((h) => ({ date: h.date, label: h.label, text: `${formatDay(h.date, t.lang)} · ${t(h.label)}` }))} />
      </section>

      <section className="space-y-3">
        <h2 className="h-site">{t('Ferien-Limiten')}</h2>
        <p className="text-sm text-charcoal-muted">{t('In diesem Zeitraum dürfen höchstens so viele Personen gleichzeitig Ferien haben. Mitarbeiter können darüber hinaus nichts anfragen. Die Leitung kann Ferien trotzdem direkt eintragen.')}</p>
        {rules.length === 0 ? (
          <p className="card text-sm text-charcoal-muted">{t('Noch keine Limiten.')}</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <RuleRow key={r.id} id={r.id} label={r.label} range={`${formatDay(r.startDate, t.lang)} – ${formatDay(r.endDate, t.lang)}`} max={r.maxPeople} />
            ))}
          </ul>
        )}
        <RuleForm site={site.id} year={year} />
      </section>
    </div>
  );
}
