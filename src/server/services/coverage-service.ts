import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  DINNER_WINDOW,
  LUNCH_WINDOW,
  needHours,
  needsFromShifts,
  offerCovers,
  offeredMinutes,
  type CoverageDay,
  type DayNeed,
} from '../../domain/availability';
import { domainError } from '../../domain/errors';
import { isPlanner, type Principal } from '../../domain/roles';
import { needFor } from '../../domain/season';
import { listSpecialDays } from './season-service';
import { ROSTER_SITES, mustReportTimes, weekDates, shiftNetMinutes, worksByPlan, type AvailabilityDay, type AvailabilityKind } from '../../domain/roster';
import { weeklyMinutes } from '../../domain/hours';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { absences, availability, availabilityPatterns, shifts, staffingNeeds } from '../db/schema';
import { listTeam } from './roster-service';

function requirePlanner(p: Principal) {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
}

function requireSite(siteId: string) {
  if (!ROSTER_SITES.some((s) => s.id === siteId)) throw domainError('NOT_FOUND', 'Unknown site');
}

const EMPTY: DayNeed = { lunchPeople: 0, dinnerPeople: 0 };

/** How many people the site needs at Lunch and at Dinner, Monday to Sunday. */
export async function getNeeds(db: AppDatabase, p: Principal, siteId: string): Promise<DayNeed[]> {
  requirePlanner(p);
  requireSite(siteId);
  const rows = await db.select().from(staffingNeeds).where(eq(staffingNeeds.site, siteId));
  return Array.from({ length: 7 }, (_, i) => {
    const r = rows.find((x) => x.weekday === i + 1);
    return r ? { lunchPeople: r.lunchPeople, dinnerPeople: r.dinnerPeople } : EMPTY;
  });
}

export async function saveNeeds(db: AppDatabase, p: Principal, siteId: string, needs: DayNeed[]): Promise<void> {
  requirePlanner(p);
  requireSite(siteId);
  if (needs.length !== 7 || needs.some((n) => ![n.lunchPeople, n.dinnerPeople].every((v) => Number.isInteger(v) && v >= 0 && v <= 60))) {
    throw domainError('VALIDATION_FAILED', 'Die Anzahl Personen ist ungültig (0 bis 60).');
  }
  await db.transaction(async (tx) => {
    for (const [i, n] of needs.entries()) {
      await tx
        .insert(staffingNeeds)
        .values({ site: siteId, weekday: i + 1, lunchPeople: n.lunchPeople, dinnerPeople: n.dinnerPeople })
        .onConflictDoUpdate({ target: [staffingNeeds.site, staffingNeeds.weekday], set: { lunchPeople: n.lunchPeople, dinnerPeople: n.dinnerPeople } });
    }
  });
  await audit(db, p.userId, 'needs.save', 'site', siteId, { needs });
}

/** Takes the need from a planned week: how many different people work at Lunch / Dinner each weekday. */
export async function deriveNeedsFromWeek(db: AppDatabase, p: Principal, siteId: string, weekStart: string): Promise<DayNeed[]> {
  requirePlanner(p);
  requireSite(siteId);
  const dates = weekDates(weekStart);
  const rows = await db.select().from(shifts).where(and(eq(shifts.site, siteId), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!)));
  const needs = needsFromShifts(rows.map((r) => ({ date: r.workDate, userId: r.userId, startMin: r.startMin, endMin: r.endMin })), weekStart);
  await saveNeeds(db, p, siteId, needs);
  return needs;
}

export interface Coverage {
  days: CoverageDay[];
  totals: {
    /** Hours the week needs: needed people × service hours. */
    needHours: number;
    /** What the team's contracts add up to per week (42.5 h × pensum). */
    contractHours: number;
    /** Hours staff have offered for the week. */
    offeredHours: number;
    /** Hours already planned as shifts. */
    plannedHours: number;
  };
  /** Staff who have not offered anything for the week yet. */
  silent: string[];
}

/** Need, offers and plan side by side for one week of a site. */
export async function getCoverage(db: AppDatabase, p: Principal, siteId: string, weekStart: string): Promise<Coverage> {
  requirePlanner(p);
  requireSite(siteId);
  const dates = weekDates(weekStart);
  const [weekdayNeeds, team, specials] = await Promise.all([getNeeds(db, p, siteId), listTeam(db, siteId), listSpecialDays(db, siteId, dates[0]!, dates[6]!)]);
  // Holidays, Silvester or closed days replace the usual need of that weekday
  const needs = dates.map((date, i) => needFor(weekdayNeeds[i]!, specials.find((s) => s.date === date)));
  const ids = team.map((m) => m.userId);
  const av = ids.length
    ? (await db.select().from(availability).where(and(inArray(availability.userId, ids), gte(availability.workDate, dates[0]!), lte(availability.workDate, dates[6]!)))).map(
        (a): AvailabilityDay => ({ userId: a.userId, date: a.workDate, kind: a.kind as AvailabilityKind, fromMin: a.fromMin, toMin: a.toMin }),
      )
    : [];
  const away = ids.length
    ? await db.select().from(absences).where(and(inArray(absences.userId, ids), inArray(absences.status, ['APPROVED', 'REQUESTED']), lte(absences.startDate, dates[6]!), gte(absences.endDate, dates[0]!)))
    : [];
  // A Standardwoche applies to days without an entry; people with a Pensum report nothing and count as available
  const patterns = ids.length ? await db.select().from(availabilityPatterns).where(inArray(availabilityPatterns.userId, ids)) : [];
  const fromPattern: AvailabilityDay[] = patterns.flatMap((pat) =>
    dates.flatMap((date, i): AvailabilityDay[] => (pat.weekday === i + 1 && !av.some((a) => a.userId === pat.userId && a.date === date) ? [{ userId: pat.userId, date, kind: pat.kind as AvailabilityKind, fromMin: pat.fromMin, toMin: pat.toMin }] : [])),
  );
  const implicit: AvailabilityDay[] = team
    .filter((m) => worksByPlan(m))
    .flatMap((m) => dates.filter((date) => !av.some((a) => a.userId === m.userId && a.date === date) && !fromPattern.some((a) => a.userId === m.userId && a.date === date)).map((date): AvailabilityDay => ({ userId: m.userId, date, kind: 'AVAILABLE', fromMin: null, toMin: null })));
  const isAway = (userId: string, date: string) => away.some((a) => a.userId === userId && a.startDate <= date && date <= a.endDate);
  const planned = await db.select().from(shifts).where(and(eq(shifts.site, siteId), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!)));

  const days: CoverageDay[] = dates.map((date, i) => {
    const offers = [...av, ...fromPattern, ...implicit].filter((a) => a.date === date && !isAway(a.userId, date));
    const day = planned.filter((s) => s.workDate === date && s.userId);
    const inWindow = (w: { fromMin: number; toMin: number }) => new Set(day.filter((s) => s.startMin < w.toMin && s.endMin > w.fromMin).map((s) => s.userId)).size;
    return {
      date,
      need: needs[i]!,
      special: specials.find((s) => s.date === date)?.label ?? null,
      offeredLunch: offers.filter((o) => offerCovers(o, LUNCH_WINDOW)).length,
      offeredDinner: offers.filter((o) => offerCovers(o, DINNER_WINDOW)).length,
      plannedLunch: inWindow(LUNCH_WINDOW),
      plannedDinner: inWindow(DINNER_WINDOW),
    };
  });

  return {
    days,
    totals: {
      needHours: needHours(needs),
      contractHours: team.reduce((sum, m) => sum + (m.pensumPercent ? weeklyMinutes(m.pensumPercent) / 60 : 0), 0),
      offeredHours: av.filter((a) => !isAway(a.userId, a.date)).reduce((sum, a) => sum + offeredMinutes(a), 0) / 60,
      plannedHours: planned.filter((s) => s.userId).reduce((sum, s) => sum + shiftNetMinutes(s), 0) / 60,
    },
    silent: team.filter((m) => mustReportTimes(m.employmentType) && !av.some((a) => a.userId === m.userId) && !patterns.some((x) => x.userId === m.userId)).map((m) => m.name),
  };
}
