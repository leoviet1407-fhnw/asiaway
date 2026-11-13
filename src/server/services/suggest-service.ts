import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isPlanner, type Principal } from '../../domain/roles';
import { ROSTER_SITES, shiftNetMinutes, stationsOf, weekDates, type AvailabilityDay, type AvailabilityKind } from '../../domain/roster';
import { needFor } from '../../domain/season';
import { suggestShifts, type SuggestGap } from '../../domain/suggest';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { absences, availability, availabilityPatterns, shifts } from '../db/schema';
import { getNeeds } from './coverage-service';
import { listTeam, saveShift } from './roster-service';
import { listSpecialDays } from './season-service';

export interface SuggestionResult {
  created: number;
  gaps: SuggestGap[];
}

/**
 * Fills an empty week as a draft: who works Lunch and Dinner on each day, from the staffing need,
 * what staff offered (or their Standardwoche) and their contracts. Nothing is published.
 */
export async function suggestWeek(db: AppDatabase, p: Principal, siteId: string, weekStart: string, now = new Date()): Promise<SuggestionResult> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
  if (!ROSTER_SITES.some((s) => s.id === siteId)) throw domainError('NOT_FOUND', 'Unknown site');
  const dates = weekDates(weekStart);
  const existing = await db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.site, siteId), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!))).limit(1);
  if (existing.length) throw domainError('VALIDATION_FAILED', 'Der Vorschlag geht nur für eine leere Woche.');

  const [weekdayNeeds, team, specials] = await Promise.all([getNeeds(db, p, siteId), listTeam(db, siteId), listSpecialDays(db, siteId, dates[0]!, dates[6]!)]);
  const needs = dates.map((date, i) => needFor(weekdayNeeds[i]!, specials.find((s) => s.date === date)));
  if (needs.every((n) => n.lunchPeople === 0 && n.dinnerPeople === 0)) throw domainError('VALIDATION_FAILED', 'Der Bedarf ist noch nicht festgelegt (Mehr > Bedarf & Abdeckung).');
  const ids = team.map((m) => m.userId);
  if (ids.length === 0) throw domainError('VALIDATION_FAILED', 'Noch niemand im Team.');

  const rows = await db.select().from(availability).where(and(inArray(availability.userId, ids), gte(availability.workDate, dates[0]!), lte(availability.workDate, dates[6]!)));
  const patterns = await db.select().from(availabilityPatterns).where(inArray(availabilityPatterns.userId, ids));
  // What a person can do on a date: their own entry, else their Standardwoche
  const offers: AvailabilityDay[] = [];
  for (const m of team) {
    dates.forEach((date, i) => {
      const own = rows.find((r) => r.userId === m.userId && r.workDate === date);
      const pat = patterns.find((x) => x.userId === m.userId && x.weekday === i + 1);
      const src = own ?? pat;
      if (src) offers.push({ userId: m.userId, date, kind: src.kind as AvailabilityKind, fromMin: src.fromMin, toMin: src.toMin });
    });
  }
  const away = await db.select().from(absences).where(and(inArray(absences.userId, ids), inArray(absences.status, ['APPROVED', 'REQUESTED']), lte(absences.startDate, dates[6]!), gte(absences.endDate, dates[0]!)));
  // Hours people already work at the other site this week count towards their contract
  const other = await db.select().from(shifts).where(and(inArray(shifts.userId, ids), ne(shifts.site, siteId), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!)));

  const result = suggestShifts({
    weekStart,
    people: team.map((m) => ({ userId: m.userId, name: m.name, employmentType: m.employmentType, pensumPercent: m.pensumPercent, plannedMinutes: other.filter((s) => s.userId === m.userId).reduce((sum, s) => sum + shiftNetMinutes(s), 0) })),
    needs,
    offers,
    away: (userId, date) => away.some((a) => a.userId === userId && a.startDate <= date && date <= a.endDate),
  });

  const station = stationsOf(siteId)[0]?.name ?? '';
  for (const s of result.shifts) {
    await saveShift(db, p, { site: siteId, date: s.date, userId: s.userId, startMin: s.startMin, endMin: s.endMin, breakMin: 0, station, roleLabel: null }, now);
  }
  await audit(db, p.userId, 'roster.suggest', 'site', siteId, { weekStart, created: result.shifts.length, gaps: result.gaps.length });
  return { created: result.shifts.length, gaps: result.gaps };
}
