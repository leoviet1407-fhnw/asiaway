import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { isPlanner } from '@/domain/roles';
import { formatTime } from '@/domain/roster';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { shifts } from '@/server/db/schema';
import { listChangeRequests } from '@/server/services/change-request-service';
import { getProfile } from '@/server/services/roster-service';
import { getT } from '@/i18n/server';
import { ChangeForm, RequestRow, type RowData } from './Forms';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Änderungsanfragen') };
}

export default async function ChangeRequestsPage({ searchParams }: { searchParams: Promise<{ shift?: string; extra?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  const params = await searchParams;
  const database = await db();
  const planner = isPlanner(p);
  const profile = await getProfile(database, p.userId);
  const rows = await listChangeRequests(database, p);
  const open = rows.filter((r) => r.status === 'REQUESTED');
  const done = rows.filter((r) => r.status !== 'REQUESTED').slice(0, 15);

  // The shift the person wants to change (opened from "Meine nächsten Schichten")
  let form: { shiftId: string; date: string; startMin: number; endMin: number; breakMin: number; label: string } | null = null;
  if (params.shift && /^[0-9a-f-]{36}$/i.test(params.shift)) {
    const [s] = await database.select().from(shifts).where(eq(shifts.id, params.shift)).limit(1);
    if (s && s.userId === p.userId) form = { shiftId: s.id, date: s.workDate, startMin: s.startMin, endMin: s.endMin, breakMin: s.breakMin, label: `${s.roleLabel ?? s.station}` };
  }

  const toRow = (r: (typeof rows)[number]): RowData => ({
    id: r.id,
    who: r.userName,
    kind: r.kind,
    date: r.date,
    from: r.startMin === null ? null : formatTime(r.startMin),
    to: r.endMin === null ? null : formatTime(r.endMin),
    plan: r.shift ? `${formatTime(r.shift.startMin)}–${formatTime(r.shift.endMin)}` : null,
    reason: r.reason,
    status: r.status,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <div>
        <Link href="/dienstplan" className="text-sm text-charcoal-muted hover:text-navy">{t('← Dienstplan')}</Link>
        <h1 className="mt-1 text-2xl">{t('Änderungsanfragen')}</h1>
        <p className="text-charcoal-muted">
          {planner ? t('Mitarbeiter fragen hier Änderungen an. Genehmigte Änderungen werden sofort im Plan übernommen.') : t('Möchten Sie eine Schicht ändern oder können nicht kommen? Fragen Sie es hier an. Die Leitung entscheidet.')}
        </p>
      </div>

      {profile && form && <ChangeForm {...form} planLabel={`${formatTime(form.startMin)}–${formatTime(form.endMin)}`} />}
      {profile && !form && !planner && (
        <p className="card text-sm text-charcoal-muted">{t('Eine Schicht ändern: Auf der Startseite bei „Meine nächsten Schichten“ auf „Ändern“ tippen. Gearbeitete Zeit ändern: unter „Meine Stunden“.')}</p>
      )}

      <section className="space-y-2">
        <h2 className="h-site flex items-center gap-2">{planner ? t('Offene Anfragen') : t('Meine offenen Anfragen')} <span className="chip bg-navy-50 text-navy">{open.length}</span></h2>
        {open.length === 0 ? (
          <p className="card text-sm text-charcoal-muted">{t('Keine offenen Anfragen.')}</p>
        ) : (
          <ul className="space-y-2">
            {open.map((r) => <RequestRow key={r.id} row={toRow(r)} mode={planner ? 'planner' : 'own'} showWho={planner} />)}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="h-site">{t('Zuletzt entschieden')}</h2>
          <ul className="space-y-2">
            {done.map((r) => <RequestRow key={r.id} row={toRow(r)} mode="history" showWho={planner} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

