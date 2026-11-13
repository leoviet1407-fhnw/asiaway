import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { monthTargetMinutes, type VacationBalance } from '../../domain/hours';
import { domainError } from '../../domain/errors';
import { isPlanner, type Principal, type Role } from '../../domain/roles';
import { ROSTER_SITES, addDays, monthDates, shiftNetMinutes, weekDates, type EmploymentType } from '../../domain/roster';
import type { AppDatabase } from '../db/client';
import { dailyClosings, locations, shifts, staffProfiles, timeEntries, userRoles, users } from '../db/schema';
import { autoConfirmShifts, getMonthHours, getVacationBalance } from './hours-service';

/** Overview for the Leitung and admins: the whole team, hours, holidays, overtime, staffing and sales. */
function requirePlanner(p: Principal) {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
}

export interface StaffRow {
  userId: string;
  name: string;
  email: string;
  site: string;
  siteName: string;
  employmentType: EmploymentType;
  pensumPercent: number | null;
  active: boolean;
  /** Login roles, e.g. STAFF or ORDERER. */
  roles: Role[];
  plannedMinutes: number;
  workedMinutes: number;
  targetMinutes: number | null;
  /** Overtime of the month; null without a pensum. */
  overtimeMinutes: number | null;
  /** Year balance of approved months. */
  overtimeBalanceMinutes: number | null;
  vacation: VacationBalance;
}

export interface DayStaffing {
  date: string;
  hours: number;
  people: number;
  shifts: number;
}

export interface SalesDay {
  date: string;
  grossCents: number;
  tipsCents: number;
}

export interface Overview {
  month: string;
  year: number;
  staff: StaffRow[];
  week: { weekStart: string; days: DayStaffing[] };
  sales: { days: SalesDay[]; totalCents: number; tipsCents: number; averageCents: number; closings: number };
}

export async function getOverview(
  db: AppDatabase,
  p: Principal,
  { month, weekStart, siteId, today }: { month: string; weekStart: string; siteId?: string | undefined; today: string },
): Promise<Overview> {
  requirePlanner(p);
  const year = Number(month.slice(0, 4));
  const dates = monthDates(month);
  const [from, to] = [dates[0]!, dates.at(-1)!];

  const profiles = await db
    .select({ p: staffProfiles, u: users })
    .from(staffProfiles)
    .innerJoin(users, eq(users.id, staffProfiles.userId))
    .orderBy(asc(staffProfiles.site), asc(staffProfiles.sort), asc(users.name));
  const filtered = profiles.filter((r) => !siteId || r.p.site === siteId || r.p.extraSites.includes(siteId));
  const ids = filtered.map((r) => r.u.id);

  // Past shifts count as worked as planned: record them before the hours are added up
  const now = new Date(`${today}T12:00:00Z`);
  for (const id of ids) await autoConfirmShifts(db, id, from, to, now);
  const roleRows = ids.length ? await db.select().from(userRoles).where(inArray(userRoles.userId, ids)) : [];
  const monthShifts = ids.length ? await db.select().from(shifts).where(and(inArray(shifts.userId, ids), gte(shifts.workDate, from), lte(shifts.workDate, to))) : [];
  const monthEntries = ids.length ? await db.select().from(timeEntries).where(and(inArray(timeEntries.userId, ids), gte(timeEntries.workDate, from), lte(timeEntries.workDate, to))) : [];

  const staff: StaffRow[] = [];
  for (const r of filtered) {
    const vacation = await getVacationBalance(db, p, r.u.id, year);
    const hours = await getMonthHours(db, p, r.u.id, month, now);
    const pensum = r.p.pensumPercent;
    staff.push({
      userId: r.u.id,
      name: r.u.name,
      email: r.u.email,
      site: r.p.site,
      siteName: ROSTER_SITES.find((s) => s.id === r.p.site)?.name ?? r.p.site,
      employmentType: r.p.employmentType as EmploymentType,
      pensumPercent: pensum,
      active: r.p.active && r.u.active,
      roles: [...new Set(roleRows.filter((x) => x.userId === r.u.id).map((x) => x.role as Role))],
      plannedMinutes: monthShifts.filter((s) => s.userId === r.u.id).reduce((sum, s) => sum + shiftNetMinutes(s), 0),
      workedMinutes: monthEntries.filter((e) => e.userId === r.u.id).reduce((sum, e) => sum + shiftNetMinutes(e), 0),
      targetMinutes: pensum === null ? null : monthTargetMinutes(pensum, month),
      overtimeMinutes: hours.totals.overtimeMinutes,
      overtimeBalanceMinutes: hours.yearBalanceMinutes,
      vacation,
    });
  }

  // Staffing per weekday of the chosen week
  const week = weekDates(weekStart);
  const weekRows = await db
    .select()
    .from(shifts)
    .where(and(gte(shifts.workDate, week[0]!), lte(shifts.workDate, week[6]!), ...(siteId ? [eq(shifts.site, siteId)] : [])));
  const days: DayStaffing[] = week.map((date) => {
    const day = weekRows.filter((s) => s.workDate === date && s.userId);
    return { date, hours: day.reduce((sum, s) => sum + shiftNetMinutes(s), 0) / 60, people: new Set(day.map((s) => s.userId)).size, shifts: day.length };
  });

  // Sales: POS gross per day for the last 30 days (all restaurants, or the site's)
  const salesFrom = addDays(today, -29);
  const siteLocations = siteId ? ROSTER_SITES.find((s) => s.id === siteId)?.locationIds ?? [] : null;
  const closingRows = await db.select().from(dailyClosings).where(and(gte(dailyClosings.businessDate, salesFrom), lte(dailyClosings.businessDate, today)));
  const rel = closingRows.filter((c) => !siteLocations || siteLocations.includes(c.locationId));
  const salesDays: SalesDay[] = Array.from({ length: 30 }, (_, i) => addDays(salesFrom, i)).map((date) => {
    const day = rel.filter((c) => c.businessDate === date);
    const gross = day.reduce((s, c) => s + c.posGrossCents, 0);
    const actual = day.reduce((s, c) => s + (c.cashCountedCents - c.startFloatCents) + c.eftCents + c.mobileCents, 0);
    return { date, grossCents: gross, tipsCents: Math.max(0, actual - gross) };
  });
  const total = salesDays.reduce((s, d) => s + d.grossCents, 0);
  const openDays = salesDays.filter((d) => d.grossCents > 0).length;

  void locations;
  return {
    month,
    year,
    staff,
    week: { weekStart, days },
    sales: { days: salesDays, totalCents: total, tipsCents: salesDays.reduce((s, d) => s + d.tipsCents, 0), averageCents: openDays ? Math.round(total / openDays) : 0, closings: rel.length },
  };
}
