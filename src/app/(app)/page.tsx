import Link from 'next/link';
import { isOrderer, isPlanner } from '@/domain/roles';
import { formatChf } from '@/domain/qty';
import { formatDay, monthLabel, todayIso } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { addDays, dueMonth, formatTime, mustReportTimes, stationsOf, type EmploymentType } from '@/domain/roster';
import { getAvailabilityMonth, getProfile, getWeekStatuses, listMyShifts } from '@/server/services/roster-service';
import { getMonthHours, getVacationBalance } from '@/server/services/hours-service';
import { countOpenRequests } from '@/server/services/change-request-service';
import { listOrders } from '@/server/services/order-service';
import { listReceivable } from '@/server/services/receiving-service';
import { OrderStatusChip } from '@/components/StatusChip';
import { Icon, type IconName } from '@/components/Icon';
import { RESERVATIONS_URL } from '@/lib/site-images';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Start') };
}

export default async function HomePage() {
  const t = await getT();
  const p = await requirePrincipal();
  const database = await db();
  const drafts = await listOrders(database, p, { statuses: ['DRAFT'] });
  const submitted = await listOrders(database, p, { statuses: ['SUBMITTED'] });
  const deliveries = await listReceivable(database, p);
  const orderer = isOrderer(p);
  const planner = isPlanner(p);
  const profile = await getProfile(database, p.userId);
  const today = todayIso();
  const month = dueMonth(today);

  // For people on the roster: their next shifts and what they still have to do
  let myShifts: Awaited<ReturnType<typeof listMyShifts>> = [];
  let availability: { done: boolean; missingDays: number; shortWeeks: number } | null = null;
  let unconfirmed = 0;
  let vacation: Awaited<ReturnType<typeof getVacationBalance>> | null = null;
  const openRequests = profile || planner ? await countOpenRequests(database, p) : 0;
  if (profile) {
    myShifts = await listMyShifts(database, p, today, addDays(today, 13));
    const [status, reportMonth, hours] = await Promise.all([
      getWeekStatuses(database, p, p.userId, month),
      getAvailabilityMonth(database, p, p.userId, month),
      getMonthHours(database, p, p.userId, today.slice(0, 7)),
    ]);
    const shortWeeks = status.weeks.filter((w) => w.enforced && !w.ok).length;
    // People with a Pensum report no times, only holiday; casual staff report the times they can work
    if (mustReportTimes(profile.employmentType as EmploymentType)) availability = { done: reportMonth.submittedAt !== null, missingDays: 0, shortWeeks: 0 };
    if (!mustReportTimes(profile.employmentType as EmploymentType)) vacation = await getVacationBalance(database, p, p.userId, Number(today.slice(0, 4)));
    unconfirmed = hours.planned.filter((s) => s.date <= today && s.entryId === null).length;
  }
  const stationOf = (siteId: string, name: string) => stationsOf(siteId).find((x) => x.name === name);
  const dayWord = (iso: string) => (iso === today ? t('Heute') : iso === addDays(today, 1) ? t('Morgen') : formatDay(iso, t.lang));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl">{t('Hallo')} {p.name.split(' ')[0]}</h1>

      {planner && openRequests > 0 && (
        <Link href="/dienstplan/anfragen" className="block rounded-btn bg-navy p-4 text-white">
          <div className="font-semibold">{t('{n} Änderungsanfragen warten', { n: openRequests })}</div>
          <div className="text-sm text-white/85">{t('Mitarbeiter möchten Schichten oder Arbeitszeiten ändern.')}</div>
        </Link>
      )}

      {profile && vacation && (
        <Link href="/dienstplan/verfuegbarkeit" className="flex items-center justify-between gap-3 rounded-btn bg-white p-3 ring-1 ring-surface-line">
          <span className="font-semibold text-navy">{t('Ferien')} {vacation.year}: {vacation.remaining} {t('Tage Rest')}</span>
          <span className="text-sm text-brand-600 underline">{t('Ferien eintragen')}</span>
        </Link>
      )}

      {profile && availability && (
        <div className="space-y-3">
          {!availability.done ? (
            <Link href={`/dienstplan/verfuegbarkeit?monat=${month}`} className="block rounded-btn bg-brand-600 p-4 text-white">
              <div className="text-lg font-semibold">{t('Verfügbarkeit melden')}</div>
              <div className="text-sm text-white/90">
                {t('Für {month} – einen Monat im Voraus.', { month: monthLabel(month, t.lang) })}
                {availability.missingDays > 0 && ` ${t('{n} Tage sind noch offen.', { n: availability.missingDays })}`}
                {availability.shortWeeks > 0 && ` ${t('{n} Wochen haben zu wenig Stunden.', { n: availability.shortWeeks })}`}
              </div>
              <div className="mt-2 inline-block rounded-btn bg-white px-4 py-2 text-sm font-bold uppercase tracking-wide text-brand-600">{t('Jetzt melden')} →</div>
            </Link>
          ) : (
            <Link href={`/dienstplan/verfuegbarkeit?monat=${month}`} className="flex items-center justify-between gap-3 rounded-btn bg-ok-50 p-3 text-ok-500">
              <span className="font-semibold">✓ {t('Verfügbarkeit für {month} gemeldet', { month: monthLabel(month, t.lang) })}</span>
              <span className="text-sm underline">{t('Ändern')}</span>
            </Link>
          )}
          {unconfirmed > 0 && (
            <Link href="/dienstplan/stunden" className="block rounded-btn bg-navy p-4 text-white">
              <div className="font-semibold">{t('{n} Schichten bestätigen', { n: unconfirmed })}</div>
              <div className="text-sm text-white/85">{t('Haben Sie diese Schichten gearbeitet? Ein Tipp genügt.')}</div>
            </Link>
          )}
        </div>
      )}

      {profile && (
        <section>
          <h2 className="h-site mb-3 flex items-center justify-between gap-2">
            <span>{t('Meine nächsten Schichten')}</span>
            <Link href="/dienstplan" className="text-sm font-normal normal-case tracking-normal text-brand-600 underline">{t('Ganzer Plan')}</Link>
          </h2>
          {myShifts.length === 0 ? (
            <p className="card text-sm text-charcoal-muted">{t('Noch keine Schichten veröffentlicht. Der Plan erscheint hier, sobald die Leitung ihn veröffentlicht hat.')}</p>
          ) : (
            <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
              {myShifts.map((s, i) => {
                const st = stationOf(s.site, s.station);
                return (
                  <li key={s.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${i === 0 ? 'bg-brand-50/50' : ''}`}>
                    <div>
                      <div className="font-semibold text-navy">{dayWord(s.date)}</div>
                      <div className="text-lg font-bold text-navy">{formatTime(s.startMin)}–{formatTime(s.endMin)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="rounded px-2.5 py-1 text-sm font-semibold" style={{ background: st?.color ?? '#e3e1df', color: st?.textColor ?? '#09141d' }}>
                        {s.roleLabel ?? s.station}
                      </span>
                      <Link href={`/dienstplan/anfragen?shift=${s.id}`} className="text-sm text-brand-600 underline">{t('Ändern')}</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        {profile ? (
          <>
            <Action href="/dienstplan" icon="calendar" label={t('Dienstplan')} primary />
            <Action href="/dienstplan/stunden" icon="cash" label={t('Meine Stunden')} badge={unconfirmed} />
            <Action href="/dienstplan/anfragen" icon="calendar" label={t('Änderungsanfragen')} badge={openRequests} />
            <Action href={`/dienstplan/verfuegbarkeit?monat=${month}`} icon="calendar" label={availability ? t('Verfügbarkeit & Ferien') : t('Ferien')} />
            <Action href="/wareneingang" icon="scan" label={t('Wareneingang')} badge={deliveries.length} />
            <Action href="/tagesabschluss/neu" icon="cash" label={t('Tagesabschluss')} />
            <Action href="/bestellungen/neu" icon="cart" label={t('Neue Bestellung')} />
            {planner && <Action href="/dienstplan/uebersicht" icon="calendar" label={t('Übersicht')} />}
            <Action href={RESERVATIONS_URL} icon="calendar" label={t('Reservationen')} external />
          </>
        ) : (
          <>
            <Action href="/bestellungen/neu" icon="cart" label={t('Neue Bestellung')} primary />
            <Action href="/wareneingang" icon="scan" label={t('Wareneingang')} badge={deliveries.length} />
            <Action href="/tagesabschluss/neu" icon="cash" label={t('Tagesabschluss')} />
            <Action href="/dienstplan" icon="calendar" label={t('Dienstplan')} />
            {planner && <Action href="/dienstplan/anfragen" icon="calendar" label={t('Änderungsanfragen')} badge={openRequests} />}
            {planner && <Action href="/dienstplan/uebersicht" icon="calendar" label={t('Übersicht')} />}
            <Action href={RESERVATIONS_URL} icon="calendar" label={t('Reservationen')} external />
          </>
        )}
      </div>

      {orderer && (
        <Section title={t('Zur Prüfung')} count={submitted.length} empty={t('Keine Bestellungen warten auf Prüfung.')}>
          {submitted.map((o) => (
            <OrderRow key={o.id} o={o} />
          ))}
        </Section>
      )}

      <Section title={t('Offene Entwürfe')} count={drafts.length} empty={t('Keine offenen Entwürfe.')}>
        {drafts.map((o) => (
          <OrderRow key={o.id} o={o} />
        ))}
      </Section>

      {!orderer && submitted.length > 0 && (
        <Section title={t('Beim Besteller zur Prüfung')} count={submitted.length} empty="">
          {submitted.map((o) => (
            <OrderRow key={o.id} o={o} />
          ))}
        </Section>
      )}

      <Section title={t('Erwartete Lieferungen')} count={deliveries.length} empty={t('Keine Lieferungen erwartet.')}>
        {deliveries.map((d) => (
          <li key={d.id}>
            <Link href="/wareneingang" className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken">
              <div>
                <div className="font-semibold text-navy">{d.supplierName}</div>
                <div className="text-sm text-charcoal-muted">
                  {d.locationName} · {d.number} · {formatDay(d.deliveryDate, t.lang)}
                </div>
              </div>
              <OrderStatusChip status={d.status} />
            </Link>
          </li>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="h-site mb-3 flex items-center gap-2">
        {title}
        <span className="chip bg-navy-50 text-navy">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="card text-sm text-charcoal-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">{children}</ul>
      )}
    </section>
  );
}

async function OrderRow({ o }: { o: Awaited<ReturnType<typeof listOrders>>[number] }) {
  const t = await getT();
  return (
    <li>
      <Link href={`/bestellungen/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-sunken">
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy">{o.supplierName}</div>
          <div className="text-sm text-charcoal-muted">
            {o.locationName} · {o.lineCount} {t('Pos. ·')} {formatChf(o.totalCents)}
          </div>
        </div>
        <OrderStatusChip status={o.status} />
      </Link>
    </li>
  );
}

function Action({ href, icon, label, primary, badge, external }: { href: string; icon: IconName; label: string; primary?: boolean; badge?: number; external?: boolean }) {
  const className = `${primary ? 'btn-primary' : 'btn-secondary'} relative h-20 flex-col gap-1 text-center normal-case tracking-normal`;
  const body = (
    <>
      <Icon name={icon} className="h-6 w-6" />
      <span className="text-base font-semibold">{label}</span>
      {badge ? <span className="absolute right-2 top-2 rounded-full bg-brand-600 px-2 text-xs font-bold text-white">{badge}</span> : null}
    </>
  );
  return external ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
