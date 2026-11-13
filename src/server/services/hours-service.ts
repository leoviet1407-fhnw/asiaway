import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  DEFAULT_VACATION_DAYS,
  monthTotals,
  vacationBalance,
  type MonthTotals,
  type VacationBalance,
} from '../../domain/hours';
import { domainError } from '../../domain/errors';
import { isOrderer, type Principal } from '../../domain/roles';
import { checkShiftTimes, monthDates, shiftNetMinutes, type AbsenceType, type Shift } from '../../domain/roster';
import { todayIso } from '../../lib/dates';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { absences, rosterWeeks, shifts, timeEntries, timeMonthApprovals, yearlyBalances } from '../db/schema';
import { getProfile, listTeam } from './roster-service';

const isPlanner = isOrderer;

function canSee(p: Principal, userId: string) {
  if (userId !== p.userId && !isPlanner(p)) throw domainError('FORBIDDEN', 'Not allowed');
}

// --- Yearly balances (entitlement, carry-over) ---------------------------------------------
export async function getYearlyBalance(db: AppDatabase, userId: string, year: number) {
  const [row] = await db.select().from(yearlyBalances).where(and(eq(yearlyBalances.userId, userId), eq(yearlyBalances.year, year))).limit(1);
  return {
    vacationDays: row ? Number(row.vacationDays) : DEFAULT_VACATION_DAYS,
    vacationCarry: row ? Number(row.vacationCarry) : 0,
    overtimeCarryMin: row?.overtimeCarryMin ?? 0,
  };
}

export async function saveYearlyBalance(
  db: AppDatabase,
  p: Principal,
  userId: string,
  year: number,
  values: { vacationDays: number; vacationCarry: number; overtimeCarryMin: number },
): Promise<void> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung kann das ändern.');
  if (!(values.vacationDays >= 0 && values.vacationDays <= 60) || !(values.vacationCarry >= -30 && values.vacationCarry <= 60) || !Number.isInteger(values.overtimeCarryMin)) {
    throw domainError('VALIDATION_FAILED', 'Ein Wert ist ungültig.');
  }
  const set = { vacationDays: String(values.vacationDays), vacationCarry: String(values.vacationCarry), overtimeCarryMin: values.overtimeCarryMin };
  await db.insert(yearlyBalances).values({ userId, year, ...set }).onConflictDoUpdate({ target: [yearlyBalances.userId, yearlyBalances.year], set });
  await audit(db, p.userId, 'balance.save', 'user', userId, { year, ...values });
}

// --- Vacation ------------------------------------------------------------------------------
export async function getVacationBalance(db: AppDatabase, p: Principal, userId: string, year: number): Promise<VacationBalance> {
  canSee(p, userId);
  const bal = await getYearlyBalance(db, userId, year);
  const rows = await db
    .select()
    .from(absences)
    .where(and(eq(absences.userId, userId), eq(absences.type, 'VACATION'), inArray(absences.status, ['APPROVED', 'REQUESTED']), lte(absences.startDate, `${year}-12-31`), gte(absences.endDate, `${year}-01-01`)));
  return vacationBalance(year, bal.vacationDays, bal.vacationCarry, rows.map((r) => ({ startDate: r.startDate, endDate: r.endDate, status: r.status as 'REQUESTED' | 'APPROVED', type: r.type as AbsenceType })));
}

// --- Hours -----------------------------------------------------------------------------------
export interface EntryView {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  breakMin: number;
  shiftId: string | null;
  note: string | null;
  netMinutes: number;
}

type EntryRow = typeof timeEntries.$inferSelect;
const toEntry = (r: EntryRow): EntryView => ({ id: r.id, date: r.workDate, startMin: r.startMin, endMin: r.endMin, breakMin: r.breakMin, shiftId: r.shiftId, note: r.note, netMinutes: shiftNetMinutes(r) });

export async function isMonthApproved(db: AppDatabase, userId: string, month: string): Promise<boolean> {
  const [row] = await db.select().from(timeMonthApprovals).where(and(eq(timeMonthApprovals.userId, userId), eq(timeMonthApprovals.month, month))).limit(1);
  return Boolean(row);
}

export interface MonthHours {
  month: string;
  entries: EntryView[];
  /** Planned shifts of the month that staff can confirm (published weeks only). */
  planned: (Shift & { entryId: string | null })[];
  absences: { startDate: string; endDate: string; type: AbsenceType }[];
  totals: MonthTotals;
  approved: boolean;
  approvedAt: Date | null;
  /** Overtime of all approved months of the year plus the opening balance; null without a target. */
  yearBalanceMinutes: number | null;
}

export async function getMonthHours(db: AppDatabase, p: Principal, userId: string, month: string): Promise<MonthHours> {
  canSee(p, userId);
  if (!/^\d{4}-\d{2}$/.test(month)) throw domainError('VALIDATION_FAILED', 'Invalid month');
  const dates = monthDates(month);
  const [first, last] = [dates[0]!, dates.at(-1)!];
  const profile = await getProfile(db, userId);
  const pensum = profile?.pensumPercent ?? null;

  const entryRows = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), gte(timeEntries.workDate, first), lte(timeEntries.workDate, last))).orderBy(asc(timeEntries.workDate), asc(timeEntries.startMin));
  const entries = entryRows.map(toEntry);

  const shiftRows = await db.select().from(shifts).where(and(eq(shifts.userId, userId), gte(shifts.workDate, first), lte(shifts.workDate, last))).orderBy(asc(shifts.workDate), asc(shifts.startMin));
  const published = new Set((await db.select().from(rosterWeeks).where(eq(rosterWeeks.status, 'PUBLISHED'))).map((w) => `${w.site}:${w.weekStart}`));
  const mondayOf = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const byShift = new Map(entries.filter((e) => e.shiftId).map((e) => [e.shiftId!, e.id]));
  const planned = shiftRows
    .filter((s) => published.has(`${s.site}:${mondayOf(s.workDate)}`))
    .map((s) => ({ id: s.id, userId: s.userId, date: s.workDate, startMin: s.startMin, endMin: s.endMin, breakMin: s.breakMin, station: s.station, roleLabel: s.roleLabel, entryId: byShift.get(s.id) ?? null }));

  const abs = (await db.select().from(absences).where(and(eq(absences.userId, userId), eq(absences.status, 'APPROVED'), lte(absences.startDate, last), gte(absences.endDate, first)))).map((a) => ({ startDate: a.startDate, endDate: a.endDate, type: a.type as AbsenceType }));
  const totals = monthTotals({ month, pensumPercent: pensum, workedMinutes: entries.reduce((s, e) => s + e.netMinutes, 0), absences: abs });
  const [approval] = await db.select().from(timeMonthApprovals).where(and(eq(timeMonthApprovals.userId, userId), eq(timeMonthApprovals.month, month))).limit(1);

  let yearBalanceMinutes: number | null = null;
  if (pensum !== null) yearBalanceMinutes = await overtimeBalance(db, userId, Number(month.slice(0, 4)), pensum);
  return { month, entries, planned, absences: abs, totals, approved: Boolean(approval), approvedAt: approval?.approvedAt ?? null, yearBalanceMinutes };
}

/** Opening balance plus the overtime of every APPROVED month of the year. */
export async function overtimeBalance(db: AppDatabase, userId: string, year: number, pensum: number): Promise<number> {
  const bal = await getYearlyBalance(db, userId, year);
  const approvals = await db.select().from(timeMonthApprovals).where(eq(timeMonthApprovals.userId, userId));
  let sum = bal.overtimeCarryMin;
  for (const a of approvals.filter((x) => x.month.startsWith(`${year}-`))) {
    const dates = monthDates(a.month);
    const entries = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), gte(timeEntries.workDate, dates[0]!), lte(timeEntries.workDate, dates.at(-1)!)));
    const abs = (await db.select().from(absences).where(and(eq(absences.userId, userId), eq(absences.status, 'APPROVED'), lte(absences.startDate, dates.at(-1)!), gte(absences.endDate, dates[0]!)))).map((x) => ({ startDate: x.startDate, endDate: x.endDate, type: x.type as AbsenceType }));
    const t = monthTotals({ month: a.month, pensumPercent: pensum, workedMinutes: entries.reduce((s, e) => s + shiftNetMinutes(e), 0), absences: abs });
    sum += t.overtimeMinutes ?? 0;
  }
  return sum;
}

async function assertEditable(db: AppDatabase, p: Principal, userId: string, date: string, now: Date) {
  canSee(p, userId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw domainError('VALIDATION_FAILED', 'Datum ist ungültig.');
  if (date > todayIso(now)) throw domainError('VALIDATION_FAILED', 'Arbeitszeit kann erst nach dem Einsatz erfasst werden.');
  if (!(await getProfile(db, userId))) throw domainError('VALIDATION_FAILED', 'Kein Team-Profil.');
  if (await isMonthApproved(db, userId, date.slice(0, 7))) throw domainError('MONTH_LOCKED', 'Month approved');
}

export interface SaveEntryInput {
  id?: string | undefined;
  userId: string;
  date: string;
  startMin: number;
  endMin: number;
  breakMin: number;
  note: string | null;
}

/** An entry that is not tied to a planned shift (extra hours, or a shift that ran differently). */
export async function saveEntry(db: AppDatabase, p: Principal, input: SaveEntryInput, now = new Date()): Promise<string> {
  await assertEditable(db, p, input.userId, input.date, now);
  const problem = checkShiftTimes(input.startMin, input.endMin, input.breakMin);
  if (problem) throw domainError('VALIDATION_FAILED', problem);
  const values = { workDate: input.date, startMin: input.startMin, endMin: input.endMin, breakMin: input.breakMin, note: input.note?.trim() || null, updatedAt: now };
  if (input.id) {
    const [existing] = await db.select().from(timeEntries).where(eq(timeEntries.id, input.id)).limit(1);
    if (!existing || existing.userId !== input.userId) throw domainError('NOT_FOUND', 'Entry not found');
    if (await isMonthApproved(db, input.userId, existing.workDate.slice(0, 7))) throw domainError('MONTH_LOCKED', 'Month approved');
    await db.update(timeEntries).set(values).where(eq(timeEntries.id, input.id));
    await audit(db, p.userId, 'hours.update', 'time_entry', input.id, { date: input.date });
    return input.id;
  }
  const [row] = await db.insert(timeEntries).values({ userId: input.userId, createdBy: p.userId, createdAt: now, ...values }).returning({ id: timeEntries.id });
  await audit(db, p.userId, 'hours.create', 'time_entry', row!.id, { date: input.date });
  return row!.id;
}

/** "Wie geplant": confirms a planned shift with its planned times. */
export async function confirmShift(db: AppDatabase, p: Principal, shiftId: string, now = new Date()): Promise<string> {
  const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
  if (!shift || !shift.userId) throw domainError('NOT_FOUND', 'Shift not found');
  await assertEditable(db, p, shift.userId, shift.workDate, now);
  const values = { workDate: shift.workDate, startMin: shift.startMin, endMin: shift.endMin, breakMin: shift.breakMin, updatedAt: now };
  const [existing] = await db.select().from(timeEntries).where(eq(timeEntries.shiftId, shiftId)).limit(1);
  if (existing) {
    await db.update(timeEntries).set(values).where(eq(timeEntries.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(timeEntries).values({ userId: shift.userId, shiftId, createdBy: p.userId, createdAt: now, ...values }).returning({ id: timeEntries.id });
  await audit(db, p.userId, 'hours.confirm', 'time_entry', row!.id, { shiftId });
  return row!.id;
}

/** Corrects the times of a planned shift (it ran longer or shorter). */
export async function correctShift(
  db: AppDatabase,
  p: Principal,
  shiftId: string,
  input: { startMin: number; endMin: number; breakMin: number; note: string | null },
  now = new Date(),
): Promise<string> {
  const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
  if (!shift || !shift.userId) throw domainError('NOT_FOUND', 'Shift not found');
  await assertEditable(db, p, shift.userId, shift.workDate, now);
  const problem = checkShiftTimes(input.startMin, input.endMin, input.breakMin);
  if (problem) throw domainError('VALIDATION_FAILED', problem);
  const values = { workDate: shift.workDate, startMin: input.startMin, endMin: input.endMin, breakMin: input.breakMin, note: input.note?.trim() || null, updatedAt: now };
  const [existing] = await db.select().from(timeEntries).where(eq(timeEntries.shiftId, shiftId)).limit(1);
  if (existing) {
    await db.update(timeEntries).set(values).where(eq(timeEntries.id, existing.id));
    await audit(db, p.userId, 'hours.update', 'time_entry', existing.id, { shiftId });
    return existing.id;
  }
  const [row] = await db.insert(timeEntries).values({ userId: shift.userId, shiftId, createdBy: p.userId, createdAt: now, ...values }).returning({ id: timeEntries.id });
  await audit(db, p.userId, 'hours.create', 'time_entry', row!.id, { shiftId });
  return row!.id;
}

export async function deleteEntry(db: AppDatabase, p: Principal, entryId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) throw domainError('NOT_FOUND', 'Entry not found');
  const [row] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId)).limit(1);
  if (!row) throw domainError('NOT_FOUND', 'Entry not found');
  canSee(p, row.userId);
  if (await isMonthApproved(db, row.userId, row.workDate.slice(0, 7))) throw domainError('MONTH_LOCKED', 'Month approved');
  await db.delete(timeEntries).where(eq(timeEntries.id, entryId));
  await audit(db, p.userId, 'hours.delete', 'time_entry', entryId);
}

/** The Leitung approves a person's month: the entries are locked and the overtime counts. */
export async function approveMonth(db: AppDatabase, p: Principal, userId: string, month: string, now = new Date()): Promise<void> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung kann freigeben.');
  if (!/^\d{4}-\d{2}$/.test(month)) throw domainError('VALIDATION_FAILED', 'Invalid month');
  await db.insert(timeMonthApprovals).values({ userId, month, approvedBy: p.userId, approvedAt: now }).onConflictDoNothing();
  await audit(db, p.userId, 'hours.approve', 'user', userId, { month });
}

export async function reopenMonth(db: AppDatabase, p: Principal, userId: string, month: string): Promise<void> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung kann das.');
  await db.delete(timeMonthApprovals).where(and(eq(timeMonthApprovals.userId, userId), eq(timeMonthApprovals.month, month)));
  await audit(db, p.userId, 'hours.reopen', 'user', userId, { month });
}

/** For the planner: every person's balance at a glance. */
export async function teamBalances(db: AppDatabase, p: Principal, siteId: string, month: string, today: string) {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
  const year = Number(today.slice(0, 4));
  const team = await listTeam(db, siteId);
  const out = [];
  for (const person of team) {
    const vacation = await getVacationBalance(db, p, person.userId, year);
    const hours = await getMonthHours(db, p, person.userId, month);
    out.push({ person, vacation, hours });
  }
  return out;
}

