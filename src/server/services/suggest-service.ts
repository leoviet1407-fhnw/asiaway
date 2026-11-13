import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isPlanner, type Principal } from '../../domain/roles';
import { ROSTER_SITES, mondayOf, shiftNetMinutes, stationsOf, weekDates, worksByPlan, type AvailabilityDay, type AvailabilityKind } from '../../domain/roster';
import { weeksOfMonth } from '../../domain/availability';
import { needFor } from '../../domain/season';
import { findGaps, suggestShifts, type GapInfo, type Service, type SuggestGap, type SuggestPerson } from '../../domain/suggest';
import { todayIso } from '../../lib/dates';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { absences, availability, availabilityPatterns, shifts } from '../db/schema';
import { getNeeds } from './coverage-service';
import { listTeam, publishWeek, saveShift, type TeamMember } from './roster-service';
import { listSpecialDays } from './season-service';

export interface SuggestionResult {
  created: number;
  gaps: SuggestGap[];
}

/** Everything the suggestion and the gap list need for one week of a site. */
async function load(db: AppDatabase, p: Principal, siteId: string, weekStart: string) {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
  if (!ROSTER_SITES.some((s) => s.id === siteId)) throw domainError('NOT_FOUND', 'Unknown site');
  const dates = weekDates(weekStart);
  const [weekdayNeeds, team, specials] = await Promise.all([getNeeds(db, p, siteId), listTeam(db, siteId), listSpecialDays(db, siteId, dates[0]!, dates[6]!)]);
  const needs = dates.map((date, i) => needFor(weekdayNeeds[i]!, specials.find((s) => s.date === date)));
  const ids = team.map((m) => m.userId);
  const rows = ids.length ? await db.select().from(availability).where(and(inArray(availability.userId, ids), gte(availability.workDate, dates[0]!), lte(availability.workDate, dates[6]!))) : [];
  const patterns = ids.length ? await db.select().from(availabilityPatterns).where(inArray(availabilityPatterns.userId, ids)) : [];
  // What a person can do on a date: their own entry, else their Standardwoche
  const offers: AvailabilityDay[] = [];
  for (const m of team) {
    dates.forEach((date, i) => {
      const src = rows.find((r) => r.userId === m.userId && r.workDate === date) ?? patterns.find((x) => x.userId === m.userId && x.weekday === i + 1);
      if (src) offers.push({ userId: m.userId, date, kind: src.kind as AvailabilityKind, fromMin: src.fromMin, toMin: src.toMin });
      // People with a Pensum report nothing: they work the plan, so they are available unless they are away
      else if (worksByPlan(m)) offers.push({ userId: m.userId, date, kind: 'AVAILABLE', fromMin: null, toMin: null });
    });
  }
  const away = ids.length ? await db.select().from(absences).where(and(inArray(absences.userId, ids), inArray(absences.status, ['APPROVED', 'REQUESTED']), lte(absences.startDate, dates[6]!), gte(absences.endDate, dates[0]!))) : [];
  const other = ids.length ? await db.select().from(shifts).where(and(inArray(shifts.userId, ids), ne(shifts.site, siteId), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!))) : [];
  const planned = await db.select().from(shifts).where(and(eq(shifts.site, siteId), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!)));
  const people: SuggestPerson[] = team.map((m) => ({
    userId: m.userId,
    name: m.name,
    employmentType: m.employmentType,
    pensumPercent: m.pensumPercent,
    plannedMinutes: other.filter((s) => s.userId === m.userId).reduce((sum, s) => sum + shiftNetMinutes(s), 0),
    usualFromMin: m.usualFromMin,
    usualToMin: m.usualToMin,
  }));
  return { team, needs, offers, people, planned, isAway: (userId: string, date: string) => away.some((a) => a.userId === userId && a.startDate <= date && date <= a.endDate) };
}

/** A person's usual station if the site has it, else the site's first station. */
function stationFor(siteId: string, member: Pick<TeamMember, 'usualStation'> | undefined) {
  const list = stationsOf(siteId);
  return list.find((s) => s.name === member?.usualStation)?.name ?? list[0]?.name ?? '';
}

/**
 * Fills an empty week as a draft: who works Lunch and Dinner on each day, from the staffing need,
 * what staff offered (or their Standardwoche) and their contracts. Nothing is published.
 */
async function compute(db: AppDatabase, p: Principal, siteId: string, weekStart: string) {
  const ctx = await load(db, p, siteId, weekStart);
  if (ctx.planned.length) throw domainError('VALIDATION_FAILED', 'Der Vorschlag geht nur für eine leere Woche.');
  if (ctx.needs.every((n) => n.lunchPeople === 0 && n.dinnerPeople === 0)) throw domainError('VALIDATION_FAILED', 'Der Bedarf ist noch nicht festgelegt (Mehr > Bedarf & Abdeckung).');
  if (ctx.team.length === 0) throw domainError('VALIDATION_FAILED', 'Noch niemand im Team.');
  return { ctx, result: suggestShifts({ weekStart, people: ctx.people, needs: ctx.needs, offers: ctx.offers, away: ctx.isAway }) };
}

/** The same suggestion without saving anything: what "Plan vorschlagen" would do. */
export async function previewWeek(db: AppDatabase, p: Principal, siteId: string, weekStart: string) {
  const { ctx, result } = await compute(db, p, siteId, weekStart);
  return { ...result, people: ctx.people };
}

export async function suggestWeek(db: AppDatabase, p: Principal, siteId: string, weekStart: string, now = new Date()): Promise<SuggestionResult> {
  const { ctx, result } = await compute(db, p, siteId, weekStart);
  for (const s of result.shifts) {
    await saveShift(db, p, { site: siteId, date: s.date, userId: s.userId, startMin: s.startMin, endMin: s.endMin, breakMin: 0, station: stationFor(siteId, ctx.team.find((m) => m.userId === s.userId)), roleLabel: null }, now);
  }
  await audit(db, p.userId, 'roster.suggest', 'site', siteId, { weekStart, created: result.shifts.length, gaps: result.gaps.length });
  return { created: result.shifts.length, gaps: result.gaps };
}

export interface MonthSuggestion {
  weeks: { weekStart: string; created: number; skipped: 'HAS_SHIFTS' | 'PAST' | 'NO_NEED' | null; gaps: SuggestGap[] }[];
}

/** Suggests every empty week of a month that has not started yet. */
export async function suggestMonth(db: AppDatabase, p: Principal, siteId: string, month: string, now = new Date()): Promise<MonthSuggestion> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
  if (!/^\d{4}-\d{2}$/.test(month)) throw domainError('VALIDATION_FAILED', 'Invalid month');
  const thisWeek = mondayOf(todayIso(now));
  const weeks: MonthSuggestion['weeks'] = [];
  for (const weekStart of weeksOfMonth(month)) {
    if (weekStart < thisWeek) {
      weeks.push({ weekStart, created: 0, skipped: 'PAST', gaps: [] });
      continue;
    }
    try {
      const r = await suggestWeek(db, p, siteId, weekStart, now);
      weeks.push({ weekStart, created: r.created, skipped: null, gaps: r.gaps });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? '';
      if (code === 'VALIDATION_FAILED' && message.includes('leere Woche')) weeks.push({ weekStart, created: 0, skipped: 'HAS_SHIFTS', gaps: [] });
      else if (code === 'VALIDATION_FAILED' && message.includes('Bedarf')) weeks.push({ weekStart, created: 0, skipped: 'NO_NEED', gaps: [] });
      else throw error;
    }
  }
  return { weeks };
}

export interface MonthPublish {
  published: string[];
  blocked: { weekStart: string; errors: number }[];
  empty: string[];
}

/** Publishes every week of a month that has shifts; weeks with rule errors are reported, not published. */
export async function publishMonth(db: AppDatabase, p: Principal, siteId: string, month: string, now = new Date()): Promise<MonthPublish> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
  if (!/^\d{4}-\d{2}$/.test(month)) throw domainError('VALIDATION_FAILED', 'Invalid month');
  const out: MonthPublish = { published: [], blocked: [], empty: [] };
  for (const weekStart of weeksOfMonth(month)) {
    const dates = weekDates(weekStart);
    const any = await db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.site, siteId), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!))).limit(1);
    if (any.length === 0) {
      out.empty.push(weekStart);
      continue;
    }
    try {
      await publishWeek(db, p, siteId, weekStart, now);
      out.published.push(weekStart);
    } catch (error) {
      const e = error as { code?: string; details?: { errors?: number } };
      if (e.code === 'ROSTER_BLOCKED') out.blocked.push({ weekStart, errors: e.details?.errors ?? 0 });
      else throw error;
    }
  }
  return out;
}

/** The short Lunch/Dinner services of a week, each with the people who could fill it. */
export async function listGaps(db: AppDatabase, p: Principal, siteId: string, weekStart: string): Promise<GapInfo[]> {
  const ctx = await load(db, p, siteId, weekStart);
  return findGaps({
    weekStart,
    people: ctx.people,
    needs: ctx.needs,
    offers: ctx.offers,
    away: ctx.isAway,
    planned: ctx.planned.map((s) => ({ userId: s.userId, date: s.workDate, startMin: s.startMin, endMin: s.endMin, breakMin: s.breakMin })),
  });
}

/** One tap on a candidate: plans the person for the short service, with their usual station. */
export async function fillGap(db: AppDatabase, p: Principal, siteId: string, date: string, service: Service, userId: string, now = new Date()): Promise<string> {
  const weekStart = mondayOf(date);
  const gap = (await listGaps(db, p, siteId, weekStart)).find((g) => g.date === date && g.service === service);
  const candidate = gap?.candidates.find((c) => c.userId === userId);
  if (!gap || !candidate) throw domainError('VALIDATION_FAILED', 'Diese Person kann den Dienst nicht übernehmen.');
  const team = await listTeam(db, siteId);
  return saveShift(db, p, { site: siteId, date, userId, startMin: candidate.startMin, endMin: candidate.endMin, breakMin: 0, station: stationFor(siteId, team.find((m) => m.userId === userId)), roleLabel: null }, now);
}

