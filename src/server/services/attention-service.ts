import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isPlanner, type Principal } from '../../domain/roles';
import { ROSTER_SITES, addDays, dueMonth, mondayOf, mustReportTimes } from '../../domain/roster';
import { todayIso } from '../../lib/dates';
import type { AppDatabase } from '../db/client';
import { absences, rosterWeeks, shifts, timeMonthApprovals } from '../db/schema';
import { countOpenRequests } from './change-request-service';
import { getNeeds } from './coverage-service';
import { listTeam, submissionOverview } from './roster-service';
import { listGaps } from './suggest-service';

export interface Todo {
  key: 'REQUESTS' | 'HOLIDAY' | 'REPORTS' | 'UNPLANNED' | 'UNPUBLISHED' | 'GAPS' | 'APPROVE';
  /** How many things need attention. */
  count: number;
  /** Names or details, already formatted. */
  detail: string;
  href: string;
  /** Site the item is about, if any. */
  site?: string;
}

const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;

/**
 * What the Leitung still has to do or wait for: requests to decide, people whose input is missing,
 * weeks that are not planned or not published yet, gaps in the plan, hours to approve.
 */
export async function getPlannerTodos(db: AppDatabase, p: Principal, now = new Date()): Promise<Todo[]> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
  const today = todayIso(now);
  const thisWeek = mondayOf(today);
  const upcoming = [0, 1, 2, 3].map((i) => addDays(thisWeek, i * 7));
  const out: Todo[] = [];

  const requests = await countOpenRequests(db, p);
  if (requests > 0) out.push({ key: 'REQUESTS', count: requests, detail: '', href: '/dienstplan/anfragen' });

  const holiday = await db.select({ id: absences.id }).from(absences).where(and(eq(absences.status, 'REQUESTED'), gte(absences.endDate, today)));
  if (holiday.length > 0) out.push({ key: 'HOLIDAY', count: holiday.length, detail: '', href: '/dienstplan/team' });

  const month = dueMonth(today);
  const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  for (const site of ROSTER_SITES) {
    // People whose input is missing: casual staff who neither reported the month nor have a Standardwoche
    const overview = await submissionOverview(db, p, site.id, month);
    const silent = overview.filter((o) => mustReportTimes(o.person.employmentType) && !o.submittedAt && !o.hasPattern).map((o) => o.person.name);
    if (silent.length > 0) out.push({ key: 'REPORTS', count: silent.length, detail: silent.join(', '), href: `/dienstplan/team?site=${site.id}&monat=${month}`, site: site.id });

    // Weeks of the next four that are empty or not published
    const needs = await getNeeds(db, p, site.id);
    const hasNeed = needs.some((n) => n.lunchPeople + n.dinnerPeople > 0);
    const rows = await db.select().from(shifts).where(and(eq(shifts.site, site.id), gte(shifts.workDate, upcoming[0]!), lte(shifts.workDate, addDays(upcoming[3]!, 6))));
    const status = new Map((await db.select().from(rosterWeeks).where(and(eq(rosterWeeks.site, site.id), inArray(rosterWeeks.weekStart, upcoming)))).map((w) => [w.weekStart, w.status]));
    const empty = upcoming.filter((w) => !rows.some((s) => s.workDate >= w && s.workDate <= addDays(w, 6)));
    if (hasNeed && empty.length > 0) out.push({ key: 'UNPLANNED', count: empty.length, detail: empty.map(dm).join(', '), href: `/dienstplan?site=${site.id}&woche=${empty[0]}`, site: site.id });
    const draft = upcoming.filter((w) => !empty.includes(w) && status.get(w) !== 'PUBLISHED');
    if (draft.length > 0) out.push({ key: 'UNPUBLISHED', count: draft.length, detail: draft.map(dm).join(', '), href: `/dienstplan?site=${site.id}&woche=${draft[0]}`, site: site.id });

    // Gaps in weeks that are planned
    let gapCount = 0;
    let firstGap: string | null = null;
    for (const w of upcoming.filter((x) => !empty.includes(x))) {
      const gaps = await listGaps(db, p, site.id, w);
      const n = gaps.reduce((sum, g) => sum + g.missing, 0);
      if (n > 0 && firstGap === null) firstGap = w;
      gapCount += n;
    }
    if (gapCount > 0) out.push({ key: 'GAPS', count: gapCount, detail: '', href: `/dienstplan?site=${site.id}&woche=${firstGap}`, site: site.id });

    // Hours of last month that nobody approved yet
    const team = await listTeam(db, site.id);
    const ids = team.map((m) => m.userId);
    if (ids.length > 0) {
      const first = `${prevMonth}-01`;
      const last = addDays(`${today.slice(0, 7)}-01`, -1);
      const worked = new Set((await db.select({ u: shifts.userId }).from(shifts).where(and(inArray(shifts.userId, ids), gte(shifts.workDate, first), lte(shifts.workDate, last)))).map((r) => r.u));
      const approved = new Set((await db.select({ u: timeMonthApprovals.userId }).from(timeMonthApprovals).where(and(inArray(timeMonthApprovals.userId, ids), eq(timeMonthApprovals.month, prevMonth)))).map((r) => r.u));
      const open = team.filter((m) => worked.has(m.userId) && !approved.has(m.userId));
      if (open.length > 0) out.push({ key: 'APPROVE', count: open.length, detail: open.map((m) => m.name).join(', '), href: `/dienstplan/team?site=${site.id}`, site: site.id });
    }
  }
  return out;
}
