import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isPlanner, type Principal } from '../../domain/roles';
import { addDays, isOpenForStaff, weekDates, type AvailabilityKind } from '../../domain/roster';
import { weeksOfMonth } from '../../domain/availability';
import { todayIso } from '../../lib/dates';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { absences, availability, availabilityPatterns, availabilitySubmissions } from '../db/schema';
import { listTeam } from './roster-service';

/** The Standardwoche: what a person can usually do on each weekday (1 = Monday … 7 = Sunday). */
export interface PatternDay {
  weekday: number;
  /** null = nothing fixed for this weekday. */
  kind: AvailabilityKind | null;
  fromMin: number | null;
  toMin: number | null;
}

function canUse(p: Principal, userId: string) {
  if (userId !== p.userId && !isPlanner(p)) throw domainError('FORBIDDEN', 'Not allowed');
}

export async function getPattern(db: AppDatabase, p: Principal, userId: string): Promise<PatternDay[]> {
  canUse(p, userId);
  const rows = await db.select().from(availabilityPatterns).where(eq(availabilityPatterns.userId, userId));
  return Array.from({ length: 7 }, (_, i) => {
    const r = rows.find((x) => x.weekday === i + 1);
    return { weekday: i + 1, kind: (r?.kind as AvailabilityKind | undefined) ?? null, fromMin: r?.fromMin ?? null, toMin: r?.toMin ?? null };
  });
}

export async function savePattern(db: AppDatabase, p: Principal, userId: string, days: PatternDay[]): Promise<void> {
  canUse(p, userId);
  if (days.length !== 7) throw domainError('VALIDATION_FAILED', 'Die Standardwoche ist ungültig.');
  for (const d of days) {
    const windowed = d.fromMin !== null && d.toMin !== null;
    if (d.kind !== null && d.kind !== 'AVAILABLE' && d.kind !== 'UNAVAILABLE') throw domainError('VALIDATION_FAILED', 'Die Standardwoche ist ungültig.');
    if (d.kind === 'AVAILABLE' && ((d.fromMin === null) !== (d.toMin === null) || (windowed && !(d.toMin! > d.fromMin! && d.fromMin! >= 0 && d.toMin! <= 30 * 60)))) {
      throw domainError('VALIDATION_FAILED', 'Die Zeit ist ungültig.');
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(availabilityPatterns).where(eq(availabilityPatterns.userId, userId));
    const rows = days.filter((d) => d.kind !== null).map((d) => ({ userId, weekday: d.weekday, kind: d.kind!, fromMin: d.kind === 'AVAILABLE' ? d.fromMin : null, toMin: d.kind === 'AVAILABLE' ? d.toMin : null }));
    if (rows.length) await tx.insert(availabilityPatterns).values(rows);
  });
  await audit(db, p.userId, 'pattern.save', 'user', userId, { days: days.filter((d) => d.kind).length });
}

/**
 * Fills the days of a month that have no entry yet from the Standardwoche.
 * Existing entries and days on holiday/sick leave stay as they are; staff only fill days they may still change.
 */
export async function applyPattern(db: AppDatabase, p: Principal, userId: string, month: string, now = new Date()): Promise<number> {
  canUse(p, userId);
  if (!/^\d{4}-\d{2}$/.test(month)) throw domainError('VALIDATION_FAILED', 'Invalid month');
  const pattern = (await getPattern(db, p, userId)).filter((d) => d.kind !== null);
  if (pattern.length === 0) throw domainError('VALIDATION_FAILED', 'Es ist noch keine Standardwoche gespeichert.');
  const weeks = weeksOfMonth(month);
  if (weeks.length === 0) return 0;
  const from = weeks[0]!;
  const to = addDays(weeks.at(-1)!, 6);
  const have = new Set((await db.select({ d: availability.workDate }).from(availability).where(and(eq(availability.userId, userId), gte(availability.workDate, from), lte(availability.workDate, to)))).map((r) => r.d));
  const away = await db
    .select()
    .from(absences)
    .where(and(eq(absences.userId, userId), inArray(absences.status, ['APPROVED', 'REQUESTED']), lte(absences.startDate, to), gte(absences.endDate, from)));
  const today = todayIso(now);
  const planner = isPlanner(p);
  const rows = weeks
    .flatMap((w) => weekDates(w).map((date, i) => ({ date, pat: pattern.find((x) => x.weekday === i + 1) })))
    .filter((x) => x.pat && !have.has(x.date) && (planner || isOpenForStaff(x.date, today)) && !away.some((a) => (a.type === 'VACATION' || a.type === 'SICK') && a.startDate <= x.date && x.date <= a.endDate))
    .map((x) => ({ userId, workDate: x.date, kind: x.pat!.kind!, fromMin: x.pat!.fromMin, toMin: x.pat!.toMin, updatedBy: p.userId, updatedAt: now }));
  if (rows.length) await db.insert(availability).values(rows).onConflictDoNothing();
  await audit(db, p.userId, 'pattern.apply', 'user', userId, { month, days: rows.length });
  return rows.length;
}

/** The Leitung fills in the Standardwoche for everybody at a site who has not reported the month yet. */
export async function fillMissingFromPatterns(db: AppDatabase, p: Principal, siteId: string, month: string, now = new Date()): Promise<{ people: number; days: number }> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
  const team = await listTeam(db, siteId);
  const done = new Set((await db.select().from(availabilitySubmissions).where(eq(availabilitySubmissions.month, month))).map((s) => s.userId));
  const hasPattern = new Set((await db.select({ u: availabilityPatterns.userId }).from(availabilityPatterns).orderBy(asc(availabilityPatterns.userId))).map((r) => r.u));
  let people = 0;
  let days = 0;
  for (const m of team) {
    if (done.has(m.userId) || !hasPattern.has(m.userId)) continue;
    const n = await applyPattern(db, p, m.userId, month, now);
    if (n > 0) people += 1;
    days += n;
  }
  return { people, days };
}
