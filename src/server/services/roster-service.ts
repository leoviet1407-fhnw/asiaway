import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isAdmin, isPlanner, type Principal } from '../../domain/roles';
import { weekStatus, weeksOfMonth, weeksToCheck } from '../../domain/availability';
import {
  LEAD_DAYS,
  firstOpenDate,
  ROSTER_SITES,
  addDays,
  checkShiftTimes,
  hasBlockingViolation,
  isOpenForStaff,
  mondayOf,
  monthDates,
  stationsOf,
  validateRoster,
  weekDates,
  type Absence,
  type AbsenceStatus,
  type AbsenceType,
  type AvailabilityDay,
  type AvailabilityKind,
  type EmploymentType,
  type RosterPerson,
  type Shift,
  type Violation,
} from '../../domain/roster';
import { todayIso } from '../../lib/dates';
import { hashPassword } from '../auth/password';
import { assertVacationAllowed } from './season-service';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import {
  absences,
  availability,
  availabilityPatterns,
  availabilitySubmissions,
  rosterWeeks,
  shifts,
  staffProfiles,
  userRoles,
  users,
} from '../db/schema';

// --- Who may do what --------------------------------------------------------------------
export { isPlanner };

/** Whether a profile belongs to the roster of a site (main site or one of the extra sites). */
export const worksAt = (profile: { site: string; extraSites?: readonly string[] | null } | null | undefined, siteId: string) =>
  !!profile && (profile.site === siteId || (profile.extraSites ?? []).includes(siteId));

export async function getProfile(db: AppDatabase, userId: string) {
  const [row] = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1);
  return row ?? null;
}

/** The sites this person may open: all for planners, their own for staff. */
export async function sitesFor(db: AppDatabase, p: Principal) {
  if (isPlanner(p)) return [...ROSTER_SITES];
  const profile = await getProfile(db, p.userId);
  return ROSTER_SITES.filter((s) => worksAt(profile, s.id));
}

function requirePlanner(p: Principal) {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung kann den Plan ändern.');
}

async function requireSite(db: AppDatabase, p: Principal, siteId: string) {
  if (!ROSTER_SITES.some((s) => s.id === siteId)) throw domainError('NOT_FOUND', 'Unknown site');
  if (isPlanner(p)) return;
  const profile = await getProfile(db, p.userId);
  if (!worksAt(profile, siteId)) throw domainError('FORBIDDEN', 'Not your site');
}

const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

// --- Team ---------------------------------------------------------------------------------
export interface TeamMember extends RosterPerson {
  email: string;
  site: string;
  extraSites: string[];
  active: boolean;
  usualStation: string | null;
  usualFromMin: number | null;
  usualToMin: number | null;
  phone: string | null;
}

export async function listTeam(db: AppDatabase, siteId: string, { includeInactive = false } = {}): Promise<TeamMember[]> {
  const rows = await db
    .select({ p: staffProfiles, u: users })
    .from(staffProfiles)
    .innerJoin(users, eq(users.id, staffProfiles.userId))
    .orderBy(asc(staffProfiles.sort), asc(users.name));
  return rows
    .filter((r) => worksAt(r.p, siteId))
    .filter((r) => includeInactive || (r.p.active && r.u.active))
    .map((r) => ({
      userId: r.u.id,
      name: r.u.name,
      email: r.u.email,
      site: r.p.site,
      extraSites: r.p.extraSites,
      usualStation: r.p.usualStation,
      usualFromMin: r.p.usualFromMin,
      usualToMin: r.p.usualToMin,
      phone: r.p.phone,
      active: r.p.active && r.u.active,
      employmentType: r.p.employmentType as EmploymentType,
      pensumPercent: r.p.pensumPercent,
    }));
}

export interface ProfileInput {
  site: string;
  /** Further sites this person is planned at. */
  extraSites?: string[];
  usualStation?: string | null;
  usualFromMin?: number | null;
  usualToMin?: number | null;
  phone?: string | null;
  employmentType: EmploymentType;
  pensumPercent: number | null;
  active: boolean;
}

function checkProfile(input: ProfileInput) {
  if (!ROSTER_SITES.some((s) => s.id === input.site)) throw domainError('VALIDATION_FAILED', 'Standort ist ungültig.');
  if ((input.extraSites ?? []).some((x) => x === input.site || !ROSTER_SITES.some((s) => s.id === x))) throw domainError('VALIDATION_FAILED', 'Standort ist ungültig.');
  if ((input.usualFromMin == null) !== (input.usualToMin == null) || (input.usualFromMin != null && !(input.usualToMin! > input.usualFromMin && input.usualFromMin >= 0 && input.usualToMin! <= 30 * 60))) {
    throw domainError('VALIDATION_FAILED', 'Die üblichen Zeiten sind ungültig.');
  }
  const needsPensum = input.employmentType === 'FULL_TIME' || input.employmentType === 'PART_TIME';
  if (needsPensum && !(input.pensumPercent && input.pensumPercent >= 1 && input.pensumPercent <= 100)) {
    throw domainError('VALIDATION_FAILED', 'Das Pensum muss zwischen 1 und 100 % liegen.');
  }
}

export async function saveProfile(db: AppDatabase, p: Principal, userId: string, input: ProfileInput): Promise<void> {
  requirePlanner(p);
  checkProfile(input);
  const values = {
    site: input.site,
    extraSites: [...new Set(input.extraSites ?? [])],
    usualStation: input.usualStation?.trim() || null,
    usualFromMin: input.usualFromMin ?? null,
    usualToMin: input.usualToMin ?? null,
    phone: input.phone?.trim() || null,
    employmentType: input.employmentType,
    pensumPercent: input.employmentType === 'FULL_TIME' || input.employmentType === 'PART_TIME' ? input.pensumPercent : null,
    active: input.active,
  };
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw domainError('NOT_FOUND', 'User not found');
  await db.insert(staffProfiles).values({ userId, ...values }).onConflictDoUpdate({ target: staffProfiles.userId, set: values });
  // Staff may enter goods-in and closings for every restaurant of their sites
  const wanted = [input.site, ...values.extraSites].flatMap((id) => ROSTER_SITES.find((s) => s.id === id)?.locationIds ?? []);
  const have = (await db.select().from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, 'STAFF')))).map((r) => r.locationId);
  const missing = wanted.filter((id) => !have.includes(id));
  if (missing.length) await db.insert(userRoles).values(missing.map((id) => ({ userId, role: 'STAFF' as const, locationId: id })));
  await audit(db, p.userId, 'team.profile', 'user', userId, values);
}

/**
 * Creates a login and a team profile in one go. Admin only. Returns the
 * one-time password, which is shown once and never stored in clear.
 */
export async function createStaffUser(
  db: AppDatabase,
  p: Principal,
  input: ProfileInput & { name: string; email: string; password: string },
): Promise<string> {
  if (!isAdmin(p)) throw domainError('FORBIDDEN', 'Nur Admins können Mitarbeiter anlegen.');
  checkProfile(input);
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw domainError('VALIDATION_FAILED', 'E-Mail ist ungültig.');
  if (!input.name.trim()) throw domainError('VALIDATION_FAILED', 'Name fehlt.');
  const hash = await hashPassword(input.password);
  const userId = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email, name: input.name.trim(), passwordHash: hash }).returning({ id: users.id });
    // Staff may enter goods-in and closings for the restaurants of their site.
    const ids = [input.site, ...(input.extraSites ?? [])].flatMap((id) => ROSTER_SITES.find((s) => s.id === id)!.locationIds);
    await tx.insert(userRoles).values(ids.map((id) => ({ userId: u!.id, role: 'STAFF' as const, locationId: id })));
    const needsPensum = input.employmentType === 'FULL_TIME' || input.employmentType === 'PART_TIME';
    await tx.insert(staffProfiles).values({ userId: u!.id, site: input.site, extraSites: [...new Set(input.extraSites ?? [])], employmentType: input.employmentType, pensumPercent: needsPensum ? input.pensumPercent : null, active: input.active });
    return u!.id;
  }).catch((error: unknown) => {
    const e = error as { code?: string; cause?: { code?: string } };
    if (e?.code === '23505' || e?.cause?.code === '23505') throw domainError('VALIDATION_FAILED', 'Diese E-Mail wird schon verwendet.');
    throw error;
  });
  await audit(db, p.userId, 'team.create', 'user', userId, { site: input.site, type: input.employmentType });
  return userId;
}

// --- The week ------------------------------------------------------------------------------
type ShiftRow = typeof shifts.$inferSelect;

const toShift = (r: ShiftRow): Shift => ({
  id: r.id,
  userId: r.userId,
  date: r.workDate,
  startMin: r.startMin,
  endMin: r.endMin,
  breakMin: r.breakMin,
  station: r.station,
  roleLabel: r.roleLabel,
});

export async function listAbsences(db: AppDatabase, userIds: string[], from: string, to: string, statuses: AbsenceStatus[] = ['APPROVED']) {
  if (userIds.length === 0) return [];
  return db
    .select()
    .from(absences)
    .where(and(inArray(absences.userId, userIds), inArray(absences.status, statuses), lte(absences.startDate, to), gte(absences.endDate, from)));
}

export interface WeekView {
  site: string;
  weekStart: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: Date | null;
  people: TeamMember[];
  shifts: Shift[];
  /** Planners only: what staff reported, and the checks. */
  availability: AvailabilityDay[];
  absences: Absence[];
  violations: Violation[];
  /** Staff cannot see a week the planner has not published. */
  hidden: boolean;
}

export async function getWeekView(db: AppDatabase, p: Principal, siteId: string, weekStart: string): Promise<WeekView> {
  await requireSite(db, p, siteId);
  if (!isoDate(weekStart)) throw domainError('VALIDATION_FAILED', 'Invalid week');
  const dates = weekDates(weekStart);
  const [week] = await db.select().from(rosterWeeks).where(and(eq(rosterWeeks.site, siteId), eq(rosterWeeks.weekStart, weekStart))).limit(1);
  const status = (week?.status ?? 'DRAFT') as 'DRAFT' | 'PUBLISHED';
  const planner = isPlanner(p);
  const people = await listTeam(db, siteId);
  if (!planner && status !== 'PUBLISHED') {
    return { site: siteId, weekStart, status, publishedAt: null, people, shifts: [], availability: [], absences: [], violations: [], hidden: true };
  }
  const rows = await db.select().from(shifts).where(and(eq(shifts.site, siteId), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!)));
  const weekShifts = rows.map(toShift);
  const ids = people.map((x) => x.userId);
  const abs = (await listAbsences(db, ids, dates[0]!, dates[6]!)).map((a) => ({ userId: a.userId, startDate: a.startDate, endDate: a.endDate, type: a.type as AbsenceType }));
  let avail: AvailabilityDay[] = [];
  let violations: Violation[] = [];
  if (planner) {
    const av = ids.length
      ? await db.select().from(availability).where(and(inArray(availability.userId, ids), gte(availability.workDate, dates[0]!), lte(availability.workDate, dates[6]!)))
      : [];
    avail = av.map((a) => ({ userId: a.userId, date: a.workDate, kind: a.kind as AvailabilityKind, fromMin: a.fromMin, toMin: a.toMin }));
    // Days without an entry count as the person's Standardwoche, if they have one
    const patterns = ids.length ? await db.select().from(availabilityPatterns).where(inArray(availabilityPatterns.userId, ids)) : [];
    for (const pat of patterns) {
      dates.forEach((date, i) => {
        if (pat.weekday === i + 1 && !avail.some((a) => a.userId === pat.userId && a.date === date)) avail.push({ userId: pat.userId, date, kind: pat.kind as AvailabilityKind, fromMin: pat.fromMin, toMin: pat.toMin });
      });
    }
    // Shifts of the same people at the other site count for rest time and weekly hours
    const everywhere = ids.length ? await db.select().from(shifts).where(and(inArray(shifts.userId, ids), gte(shifts.workDate, dates[0]!), lte(shifts.workDate, dates[6]!))) : [];
    violations = validateRoster({ weekStart, people, shifts: everywhere.map(toShift), availability: avail, absences: abs });
  }
  return { site: siteId, weekStart, status, publishedAt: week?.publishedAt ?? null, people, shifts: weekShifts, availability: avail, absences: abs, violations, hidden: false };
}

export interface SaveShiftInput {
  id?: string | undefined;
  site: string;
  date: string;
  userId: string | null;
  startMin: number;
  endMin: number;
  breakMin: number;
  station: string;
  roleLabel: string | null;
}

export async function saveShift(db: AppDatabase, p: Principal, input: SaveShiftInput, now = new Date()): Promise<string> {
  requirePlanner(p);
  if (!ROSTER_SITES.some((s) => s.id === input.site)) throw domainError('VALIDATION_FAILED', 'Standort ist ungültig.');
  if (!isoDate(input.date)) throw domainError('VALIDATION_FAILED', 'Datum ist ungültig.');
  const problem = checkShiftTimes(input.startMin, input.endMin, input.breakMin);
  if (problem) throw domainError('VALIDATION_FAILED', problem);
  if (!stationsOf(input.site).some((s) => s.name === input.station)) throw domainError('VALIDATION_FAILED', 'Station ist ungültig.');
  if (input.userId) {
    const profile = await getProfile(db, input.userId);
    if (!profile || !worksAt(profile, input.site) || !profile.active) throw domainError('VALIDATION_FAILED', 'Diese Person gehört nicht zum Team dieses Standorts.');
  }
  const values = {
    site: input.site,
    workDate: input.date,
    userId: input.userId,
    startMin: input.startMin,
    endMin: input.endMin,
    breakMin: input.breakMin,
    station: input.station,
    roleLabel: input.roleLabel?.trim() || null,
    updatedAt: now,
  };
  if (input.id) {
    const [row] = await db.update(shifts).set(values).where(and(eq(shifts.id, input.id), eq(shifts.site, input.site))).returning({ id: shifts.id });
    if (!row) throw domainError('NOT_FOUND', 'Shift not found');
    await audit(db, p.userId, 'shift.update', 'shift', row.id, { date: input.date, userId: input.userId });
    return row.id;
  }
  const [row] = await db.insert(shifts).values({ ...values, createdBy: p.userId, createdAt: now }).returning({ id: shifts.id });
  await audit(db, p.userId, 'shift.create', 'shift', row!.id, { date: input.date, userId: input.userId });
  return row!.id;
}

export async function deleteShift(db: AppDatabase, p: Principal, shiftId: string): Promise<void> {
  requirePlanner(p);
  if (!/^[0-9a-f-]{36}$/i.test(shiftId)) throw domainError('NOT_FOUND', 'Shift not found');
  const [row] = await db.delete(shifts).where(eq(shifts.id, shiftId)).returning({ id: shifts.id, date: shifts.workDate });
  if (!row) throw domainError('NOT_FOUND', 'Shift not found');
  await audit(db, p.userId, 'shift.delete', 'shift', row.id, { date: row.date });
}

/** Publishes a week so staff can see it. Refused while there are errors. */
export async function publishWeek(db: AppDatabase, p: Principal, siteId: string, weekStart: string, now = new Date()): Promise<void> {
  requirePlanner(p);
  const view = await getWeekView(db, p, siteId, weekStart);
  if (hasBlockingViolation(view.violations)) {
    throw domainError('ROSTER_BLOCKED', 'Plan has errors', { errors: view.violations.filter((v) => v.severity === 'error').length });
  }
  await db
    .insert(rosterWeeks)
    .values({ site: siteId, weekStart, status: 'PUBLISHED', publishedBy: p.userId, publishedAt: now })
    .onConflictDoUpdate({ target: [rosterWeeks.site, rosterWeeks.weekStart], set: { status: 'PUBLISHED', publishedBy: p.userId, publishedAt: now } });
  await audit(db, p.userId, 'roster.publish', 'roster_week', `${siteId}:${weekStart}`);
}

export async function unpublishWeek(db: AppDatabase, p: Principal, siteId: string, weekStart: string): Promise<void> {
  requirePlanner(p);
  await db.update(rosterWeeks).set({ status: 'DRAFT' }).where(and(eq(rosterWeeks.site, siteId), eq(rosterWeeks.weekStart, weekStart)));
  await audit(db, p.userId, 'roster.unpublish', 'roster_week', `${siteId}:${weekStart}`);
}

/** Copies last week's shifts into an empty week (a starting point to adjust). Returns how many. */
export async function copyWeek(db: AppDatabase, p: Principal, siteId: string, weekStart: string): Promise<number> {
  requirePlanner(p);
  const from = addDays(weekStart, -7);
  const existing = await db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.site, siteId), gte(shifts.workDate, weekStart), lte(shifts.workDate, addDays(weekStart, 6)))).limit(1);
  if (existing.length > 0) throw domainError('VALIDATION_FAILED', 'Diese Woche hat schon Schichten.');
  const rows = await db.select().from(shifts).where(and(eq(shifts.site, siteId), gte(shifts.workDate, from), lte(shifts.workDate, addDays(from, 6))));
  if (rows.length === 0) return 0;
  await db.insert(shifts).values(rows.map((r) => ({ site: r.site, workDate: addDays(r.workDate, 7), userId: r.userId, startMin: r.startMin, endMin: r.endMin, breakMin: r.breakMin, station: r.station, roleLabel: r.roleLabel, createdBy: p.userId })));
  await audit(db, p.userId, 'roster.copy', 'roster_week', `${siteId}:${weekStart}`, { count: rows.length });
  return rows.length;
}

/** Published shifts of one person, for "Meine Schichten". */
export async function listMyShifts(db: AppDatabase, p: Principal, from: string, to: string): Promise<(Shift & { site: string })[]> {
  const rows = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, p.userId), gte(shifts.workDate, from), lte(shifts.workDate, to)))
    .orderBy(asc(shifts.workDate), asc(shifts.startMin));
  // A shift is visible once the planner has published its week.
  const published = new Set((await db.select().from(rosterWeeks).where(eq(rosterWeeks.status, 'PUBLISHED'))).map((w) => `${w.site}:${w.weekStart}`));
  return rows.filter((r) => published.has(`${r.site}:${mondayOf(r.workDate)}`)).map((r) => ({ ...toShift(r), site: r.site }));
}

// --- Availability a month ahead -------------------------------------------------------------
export async function getAvailabilityMonth(db: AppDatabase, p: Principal, userId: string, month: string) {
  if (userId !== p.userId && !isPlanner(p)) throw domainError('FORBIDDEN', 'Not allowed');
  if (!/^\d{4}-\d{2}$/.test(month)) throw domainError('VALIDATION_FAILED', 'Invalid month');
  // The weeks of a month are the weeks whose Monday lies in it, shown in full (Mon–Sun).
  const weeks = weeksOfMonth(month);
  const dates = monthDates(month);
  const from = weeks[0] ?? dates[0]!;
  const to = weeks.length ? addDays(weeks.at(-1)!, 6) : dates.at(-1)!;
  const days = (await db.select().from(availability).where(and(eq(availability.userId, userId), gte(availability.workDate, from), lte(availability.workDate, to)))).map(
    (a): AvailabilityDay => ({ userId: a.userId, date: a.workDate, kind: a.kind as AvailabilityKind, fromMin: a.fromMin, toMin: a.toMin }),
  );
  const [submission] = await db.select().from(availabilitySubmissions).where(and(eq(availabilitySubmissions.userId, userId), eq(availabilitySubmissions.month, month))).limit(1);
  const abs = await db
    .select()
    .from(absences)
    .where(and(eq(absences.userId, userId), lte(absences.startDate, to), gte(absences.endDate, from)))
    .orderBy(asc(absences.startDate));
  return { days, submittedAt: submission?.submittedAt ?? null, absences: abs, weeks };
}

export interface SetAvailabilityInput {
  userId: string;
  date: string;
  /** null removes the entry. */
  kind: AvailabilityKind | null;
  fromMin: number | null;
  toMin: number | null;
}

/** Staff change only days that are at least LEAD_DAYS away; the planner any day. */
export async function setAvailability(db: AppDatabase, p: Principal, input: SetAvailabilityInput, now = new Date()): Promise<void> {
  const planner = isPlanner(p);
  if (input.userId !== p.userId && !planner) throw domainError('FORBIDDEN', 'Not allowed');
  if (!isoDate(input.date)) throw domainError('VALIDATION_FAILED', 'Datum ist ungültig.');
  if (!planner && !isOpenForStaff(input.date, todayIso(now))) throw domainError('TOO_LATE', 'Too late', { leadDays: LEAD_DAYS });
  if (input.kind === null) {
    await db.delete(availability).where(and(eq(availability.userId, input.userId), eq(availability.workDate, input.date)));
    return;
  }
  const windowed = input.fromMin !== null && input.toMin !== null;
  if ((input.fromMin === null) !== (input.toMin === null) || (windowed && !(input.toMin! > input.fromMin! && input.fromMin! >= 0 && input.toMin! <= 30 * 60))) {
    throw domainError('VALIDATION_FAILED', 'Die Zeit ist ungültig.');
  }
  const values = { kind: input.kind, fromMin: input.fromMin, toMin: input.toMin, updatedBy: p.userId, updatedAt: now };
  await db.insert(availability).values({ userId: input.userId, workDate: input.date, ...values }).onConflictDoUpdate({ target: [availability.userId, availability.workDate], set: values });
}

/** Everything the availability check needs for the weeks of a month. */
export async function getWeekStatuses(db: AppDatabase, p: Principal, userId: string, month: string, now = new Date()) {
  if (userId !== p.userId && !isPlanner(p)) throw domainError('FORBIDDEN', 'Not allowed');
  const profile = await getProfile(db, userId);
  const weeks = weeksOfMonth(month);
  if (weeks.length === 0) return { weeks: [], missingDays: [], openDays: 0 };
  const from = weeks[0]!;
  const to = addDays(weeks.at(-1)!, 6);
  const av = (await db.select().from(availability).where(and(eq(availability.userId, userId), gte(availability.workDate, from), lte(availability.workDate, to)))).map(
    (a): AvailabilityDay => ({ userId: a.userId, date: a.workDate, kind: a.kind as AvailabilityKind, fromMin: a.fromMin, toMin: a.toMin }),
  );
  const abs = await db
    .select()
    .from(absences)
    .where(and(eq(absences.userId, userId), inArray(absences.status, ['APPROVED', 'REQUESTED']), lte(absences.startDate, to), gte(absences.endDate, from)));
  const absList = abs.map((a) => ({ startDate: a.startDate, endDate: a.endDate, type: a.type as AbsenceType }));
  const today = todayIso(now);
  const statuses = weeks.map((w) => ({ ...weekStatus({ weekStart: w, pensumPercent: profile?.pensumPercent ?? null, availability: av, absences: absList }), enforced: weeksToCheck(month, firstOpenDate(today)).includes(w) }));
  // Open days without any choice (and not on holiday): staff must decide every day
  const dayList = weeks.flatMap((w) => weekDates(w));
  const missingDays = dayList.filter(
    (d) => isOpenForStaff(d, today) && !av.some((a) => a.date === d) && !absList.some((a) => (a.type === 'VACATION' || a.type === 'SICK') && a.startDate <= d && d <= a.endDate),
  );
  return { weeks: statuses, missingDays, openDays: dayList.filter((d) => isOpenForStaff(d, today)).length };
}

/**
 * Marks a month as reported ("Meldung abschicken"). Staff cannot send it half-done:
 * every day they can still change needs a choice, and each full week must reach
 * the hours of their contract (42.5 h × pensum).
 */
export async function submitMonth(db: AppDatabase, p: Principal, month: string, now = new Date()): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw domainError('VALIDATION_FAILED', 'Invalid month');
  const profile = await getProfile(db, p.userId);
  if (!profile) throw domainError('FORBIDDEN', 'Kein Team-Profil.');
  const status = await getWeekStatuses(db, p, p.userId, month, now);
  if (status.missingDays.length > 0) {
    const [y, m, d] = status.missingDays[0]!.split('-');
    throw domainError('VALIDATION_FAILED', `Bitte für jeden Tag etwas wählen. Noch ${status.missingDays.length} Tage ohne Auswahl, zuerst ${d}.${m}.${y}.`);
  }
  const short = status.weeks.filter((w) => w.enforced && !w.ok);
  if (short.length > 0) {
    const list = short.map((w) => `${w.weekStart.slice(8)}.${w.weekStart.slice(5, 7)}.: ${(w.offeredMinutes / 60 + w.creditMinutes / 60).toFixed(1)} h / ${((w.requiredMinutes ?? 0) / 60).toFixed(1)} h`).join('; ');
    throw domainError('VALIDATION_FAILED', `Zu wenig Stunden in diesen Wochen (Woche ab, gewählt / nötig): ${list}`);
  }
  await db.insert(availabilitySubmissions).values({ userId: p.userId, month, submittedAt: now }).onConflictDoUpdate({ target: [availabilitySubmissions.userId, availabilitySubmissions.month], set: { submittedAt: now } });
  await audit(db, p.userId, 'availability.submit', 'user', p.userId, { month });
}

/** For the planner: who has reported for the month, and what they asked for. */
export async function submissionOverview(db: AppDatabase, p: Principal, siteId: string, month: string) {
  requirePlanner(p);
  const people = await listTeam(db, siteId);
  const ids = people.map((x) => x.userId);
  if (ids.length === 0) return [];
  const dates = monthDates(month);
  const [subs, av, abs] = await Promise.all([
    db.select().from(availabilitySubmissions).where(and(inArray(availabilitySubmissions.userId, ids), eq(availabilitySubmissions.month, month))),
    db.select().from(availability).where(and(inArray(availability.userId, ids), gte(availability.workDate, dates[0]!), lte(availability.workDate, dates.at(-1)!))),
    db.select().from(absences).where(and(inArray(absences.userId, ids), inArray(absences.status, ['REQUESTED', 'APPROVED']), lte(absences.startDate, dates.at(-1)!), gte(absences.endDate, dates[0]!))),
  ]);
  return people.map((person) => ({
    person,
    submittedAt: subs.find((s) => s.userId === person.userId)?.submittedAt ?? null,
    availableDays: av.filter((a) => a.userId === person.userId && a.kind === 'AVAILABLE').length,
    unavailableDays: av.filter((a) => a.userId === person.userId && a.kind === 'UNAVAILABLE').length,
    absences: abs.filter((a) => a.userId === person.userId),
  }));
}

// --- Holidays ----------------------------------------------------------------------------------
export interface AbsenceInput {
  userId: string;
  startDate: string;
  endDate: string;
  type: AbsenceType;
  note: string | null;
}

/** Staff ask for time off (REQUESTED); the planner records it directly (APPROVED). */
export async function requestAbsence(db: AppDatabase, p: Principal, input: AbsenceInput, now = new Date()): Promise<string> {
  const planner = isPlanner(p);
  if (input.userId !== p.userId && !planner) throw domainError('FORBIDDEN', 'Not allowed');
  if (!isoDate(input.startDate) || !isoDate(input.endDate) || input.endDate < input.startDate) throw domainError('VALIDATION_FAILED', 'Das Datum ist ungültig.');
  if (!planner && input.type !== 'VACATION') throw domainError('VALIDATION_FAILED', 'Staff can only request holidays.');
  if (!planner && input.startDate < todayIso(now)) throw domainError('VALIDATION_FAILED', 'Der Beginn liegt in der Vergangenheit.');
  if (!(await getProfile(db, input.userId))) throw domainError('VALIDATION_FAILED', 'Kein Team-Profil.');
  if (!planner && input.type === 'VACATION') await assertVacationAllowed(db, input.userId, input.startDate, input.endDate);
  const [row] = await db
    .insert(absences)
    .values({
      userId: input.userId,
      startDate: input.startDate,
      endDate: input.endDate,
      type: input.type,
      status: planner ? 'APPROVED' : 'REQUESTED',
      note: input.note?.trim() || null,
      requestedAt: now,
      createdBy: p.userId,
      ...(planner ? { decidedBy: p.userId, decidedAt: now } : {}),
    })
    .returning({ id: absences.id });
  await audit(db, p.userId, 'absence.request', 'absence', row!.id, { start: input.startDate, end: input.endDate, type: input.type });
  return row!.id;
}

export async function decideAbsence(db: AppDatabase, p: Principal, absenceId: string, approve: boolean, now = new Date()): Promise<void> {
  requirePlanner(p);
  if (!/^[0-9a-f-]{36}$/i.test(absenceId)) throw domainError('NOT_FOUND', 'Absence not found');
  const [own] = await db.select({ userId: absences.userId }).from(absences).where(eq(absences.id, absenceId)).limit(1);
  if (own && own.userId === p.userId && !isAdmin(p)) throw domainError('FORBIDDEN', 'Eigene Ferien bestätigt eine andere Person der Leitung.');
  const [row] = await db.update(absences).set({ status: approve ? 'APPROVED' : 'REJECTED', decidedBy: p.userId, decidedAt: now }).where(eq(absences.id, absenceId)).returning({ id: absences.id });
  if (!row) throw domainError('NOT_FOUND', 'Absence not found');
  await audit(db, p.userId, approve ? 'absence.approve' : 'absence.reject', 'absence', absenceId);
}

/** Staff withdraw their own pending request; the planner can delete any. */
export async function cancelAbsence(db: AppDatabase, p: Principal, absenceId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(absenceId)) throw domainError('NOT_FOUND', 'Absence not found');
  const [row] = await db.select().from(absences).where(eq(absences.id, absenceId)).limit(1);
  if (!row) throw domainError('NOT_FOUND', 'Absence not found');
  if (!isPlanner(p) && !(row.userId === p.userId && row.status === 'REQUESTED')) throw domainError('FORBIDDEN', 'Not allowed');
  await db.delete(absences).where(eq(absences.id, absenceId));
  await audit(db, p.userId, 'absence.cancel', 'absence', absenceId);
}

export async function listPendingAbsences(db: AppDatabase, p: Principal, siteId: string) {
  requirePlanner(p);
  const people = await listTeam(db, siteId);
  if (people.length === 0) return [];
  const rows = await db.select().from(absences).where(and(inArray(absences.userId, people.map((x) => x.userId)), eq(absences.status, 'REQUESTED'))).orderBy(asc(absences.startDate));
  return rows.map((a) => ({ ...a, name: people.find((x) => x.userId === a.userId)?.name ?? '' }));
}

