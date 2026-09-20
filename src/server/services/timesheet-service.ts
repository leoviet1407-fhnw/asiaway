import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import {
  assertTransition,
  assertUsableWindow,
  comparePlanned,
  totalWorkedMinutes,
  workedMinutes,
  type TimeEntryState,
} from '../../domain/roster/timesheet';
import { periodCorridor } from '../../domain/roster/corridor';
import { hasHoursTarget, type EmploymentType } from '../../domain/roster/availability';
import { localDateIn, RESTAURANT_TIME_ZONE } from '../../domain/roster/time';
import {
  absences,
  employments,
  monthlyStatements,
  rosterPeriods,
  shifts,
  stations,
  timeEntries,
  timeEntryRevisions,
  users,
  workTimePolicy,
} from '../db/schema';
import type { AppDatabase } from '../db/client';

/**
 * Time recording: what was actually worked, against what was planned.
 *
 * Pay is out of scope (Part 9). Nothing here computes a balance or a wage.
 * What it does guarantee is that the facts a pay run would need are recorded
 * exactly and cannot be quietly rewritten — every correction is an append-only
 * revision naming who made it and why.
 */

type Row = typeof timeEntries.$inferSelect;

function snapshot(entry: Row): Record<string, unknown> {
  return {
    shiftId: entry.shiftId,
    businessDate: entry.businessDate,
    clockInAt: entry.clockInAt.toISOString(),
    clockOutAt: entry.clockOutAt?.toISOString() ?? null,
    breakMinutes: entry.breakMinutes,
    state: entry.state,
    note: entry.note,
  };
}

async function nextRevision(db: AppDatabase, entryId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${timeEntryRevisions.revisionNumber}), 0)::int` })
    .from(timeEntryRevisions)
    .where(eq(timeEntryRevisions.timeEntryId, entryId));
  return Number(row?.n ?? 0) + 1;
}

async function load(db: AppDatabase, entryId: string): Promise<Row> {
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId));
  if (!entry) throw domainError('VALIDATION_FAILED', 'That time entry does not exist.');
  return entry;
}

/**
 * Starting a shift.
 *
 * The open entry is matched to a planned shift on the same day where one
 * exists, so actual and planned can be compared later without anyone having
 * to remember which was which.
 */
export async function clockIn(
  db: AppDatabase,
  userId: string,
  at: Date = new Date(),
): Promise<string> {
  const businessDate = localDateIn(at, RESTAURANT_TIME_ZONE);

  const [running] = await db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), eq(timeEntries.state, 'OPEN')));
  if (running) throw domainError('VALIDATION_FAILED', 'You are already clocked in.');

  const [planned] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.userId, userId),
        eq(shifts.onDate, businessDate),
        eq(shifts.state, 'PUBLISHED'),
      ),
    )
    .orderBy(asc(shifts.startsAt))
    .limit(1);

  const [created] = await db
    .insert(timeEntries)
    .values({
      userId,
      shiftId: planned?.id ?? null,
      businessDate,
      clockInAt: at,
      source: 'CLOCK',
      state: 'OPEN',
    })
    .returning({ id: timeEntries.id });

  return created!.id;
}

/** Finishing it. The entry becomes SUBMITTED: recorded, awaiting a manager. */
export async function clockOut(
  db: AppDatabase,
  userId: string,
  breakMinutes: number,
  at: Date = new Date(),
): Promise<void> {
  const [entry] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), eq(timeEntries.state, 'OPEN')));
  if (!entry) throw domainError('VALIDATION_FAILED', 'You are not clocked in.');

  assertUsableWindow(entry.clockInAt, at, breakMinutes);
  assertTransition('OPEN', 'SUBMITTED');

  await db
    .update(timeEntries)
    .set({ clockOutAt: at, breakMinutes, state: 'SUBMITTED', updatedAt: new Date() })
    .where(eq(timeEntries.id, entry.id));
}

export interface ManualEntryInput {
  readonly userId: string;
  readonly businessDate: string;
  readonly clockInAt: Date;
  readonly clockOutAt: Date;
  readonly breakMinutes: number;
  readonly note?: string | null;
}

/** A manager recording a shift nobody clocked — the forgotten-tablet case. */
export async function recordEntry(
  db: AppDatabase,
  input: ManualEntryInput,
  managerId: string,
): Promise<string> {
  assertUsableWindow(input.clockInAt, input.clockOutAt, input.breakMinutes);

  const [planned] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.userId, input.userId), eq(shifts.onDate, input.businessDate)))
    .orderBy(asc(shifts.startsAt))
    .limit(1);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(timeEntries)
      .values({
        userId: input.userId,
        shiftId: planned?.id ?? null,
        businessDate: input.businessDate,
        clockInAt: input.clockInAt,
        clockOutAt: input.clockOutAt,
        breakMinutes: input.breakMinutes,
        source: 'MANAGER',
        state: 'SUBMITTED',
        note: input.note?.trim() || null,
      })
      .returning();

    await tx.insert(timeEntryRevisions).values({
      timeEntryId: created!.id,
      revisionNumber: 1,
      actorUserId: managerId,
      reason: 'Recorded by a manager',
      beforeSnapshot: null,
      afterSnapshot: snapshot(created!),
    });
    return created!.id;
  });
}

export interface CorrectionInput {
  readonly clockInAt?: Date;
  readonly clockOutAt?: Date;
  readonly breakMinutes?: number;
  readonly note?: string | null;
}

/**
 * Changing an entry after the fact.
 *
 * Never a silent edit: the previous values are snapshotted into an append-only
 * revision with the reason and the person who made it. A correction sends an
 * approved entry back for approval, because the thing that was approved is no
 * longer what the row says.
 */
export async function correctEntry(
  db: AppDatabase,
  entryId: string,
  changes: CorrectionInput,
  actorId: string,
  reason: string,
): Promise<void> {
  if (!reason.trim()) {
    throw domainError('REASON_REQUIRED', 'A correction needs a reason.');
  }
  const entry = await load(db, entryId);
  if (entry.state === 'OPEN') {
    throw domainError('VALIDATION_FAILED', 'Clock out before correcting the entry.');
  }

  const clockInAt = changes.clockInAt ?? entry.clockInAt;
  const clockOutAt = changes.clockOutAt ?? entry.clockOutAt;
  const breakMinutes = changes.breakMinutes ?? entry.breakMinutes;
  assertUsableWindow(clockInAt, clockOutAt, breakMinutes);

  const revisionNumber = await nextRevision(db, entryId);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(timeEntries)
      .set({
        clockInAt,
        clockOutAt,
        breakMinutes,
        note: changes.note === undefined ? entry.note : (changes.note?.trim() || null),
        state: 'SUBMITTED',
        approvedBy: null,
        approvedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, entryId))
      .returning();

    await tx.insert(timeEntryRevisions).values({
      timeEntryId: entryId,
      revisionNumber,
      actorUserId: actorId,
      reason: reason.trim(),
      beforeSnapshot: snapshot(entry),
      afterSnapshot: snapshot(updated!),
    });
  });
}

/** The employee saying the recorded hours are wrong. */
export async function disputeEntry(
  db: AppDatabase,
  entryId: string,
  userId: string,
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw domainError('REASON_REQUIRED', 'Say what is wrong with it.');

  const entry = await load(db, entryId);
  if (entry.userId !== userId) throw domainError('FORBIDDEN', 'That is not your time entry.');
  assertTransition(entry.state as TimeEntryState, 'DISPUTED');

  const revisionNumber = await nextRevision(db, entryId);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(timeEntries)
      .set({ state: 'DISPUTED', approvedBy: null, approvedAt: null, updatedAt: new Date() })
      .where(eq(timeEntries.id, entryId))
      .returning();

    await tx.insert(timeEntryRevisions).values({
      timeEntryId: entryId,
      revisionNumber,
      actorUserId: userId,
      reason: reason.trim(),
      beforeSnapshot: snapshot(entry),
      afterSnapshot: snapshot(updated!),
    });
  });
}

/** A manager accepting the hours as recorded. */
export async function approveEntry(
  db: AppDatabase,
  entryId: string,
  managerId: string,
): Promise<void> {
  const entry = await load(db, entryId);
  assertTransition(entry.state as TimeEntryState, 'APPROVED');

  await db
    .update(timeEntries)
    .set({ state: 'APPROVED', approvedBy: managerId, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(timeEntries.id, entryId));
}

export interface TimesheetRow {
  readonly id: string;
  readonly businessDate: string;
  readonly clockInAt: string;
  readonly clockOutAt: string | null;
  readonly breakMinutes: number;
  readonly workedMinutes: number;
  readonly plannedMinutes: number | null;
  readonly state: string;
  readonly source: string;
  readonly stationName: string | null;
  readonly note: string | null;
}

export interface Timesheet {
  readonly from: string;
  readonly to: string;
  readonly rows: readonly TimesheetRow[];
  readonly workedMinutes: number;
  readonly plannedMinutes: number;
  readonly varianceMinutes: number;
  /** NULL for an Aushilfe, who is owed no hours. */
  readonly corridor: { readonly minMinutes: number; readonly maxMinutes: number } | null;
  readonly openEntryId: string | null;
}

async function currentPolicy(db: AppDatabase) {
  const [row] = await db.select().from(workTimePolicy).where(isNull(workTimePolicy.validTo));
  if (!row) throw domainError('INVALID_WORK_TIME_POLICY', 'No work time policy is in force.');
  return {
    weeklyHoursMinAt100: Number(row.weeklyHoursMinAt100),
    weeklyHoursMaxAt100: Number(row.weeklyHoursMaxAt100),
  };
}

function plannedMinutesOf(shift: { startsAt: Date; endsAt: Date; plannedBreakMinutes: number }): number {
  return Math.max(
    0,
    Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60_000) -
      shift.plannedBreakMinutes,
  );
}

/** One person's hours over a date range, with what was planned beside them. */
export async function getTimesheet(
  db: AppDatabase,
  userId: string,
  from: string,
  to: string,
): Promise<Timesheet> {
  const entries = await db
    .select({
      id: timeEntries.id,
      businessDate: timeEntries.businessDate,
      clockInAt: timeEntries.clockInAt,
      clockOutAt: timeEntries.clockOutAt,
      breakMinutes: timeEntries.breakMinutes,
      state: timeEntries.state,
      source: timeEntries.source,
      note: timeEntries.note,
      shiftId: timeEntries.shiftId,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.businessDate, from),
        lte(timeEntries.businessDate, to),
      ),
    )
    .orderBy(asc(timeEntries.businessDate), asc(timeEntries.clockInAt));

  const plannedShifts = await db
    .select({
      id: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      plannedBreakMinutes: shifts.plannedBreakMinutes,
      stationName: stations.nameDe,
    })
    .from(shifts)
    .innerJoin(stations, eq(stations.id, shifts.stationId))
    .where(
      and(eq(shifts.userId, userId), gte(shifts.onDate, from), lte(shifts.onDate, to), sql`${shifts.state} <> 'CANCELLED'`),
    );

  const byShift = new Map(plannedShifts.map((s) => [s.id, s]));

  const rows: TimesheetRow[] = entries.map((entry) => {
    const planned = entry.shiftId ? byShift.get(entry.shiftId) : undefined;
    return {
      id: entry.id,
      businessDate: entry.businessDate,
      clockInAt: entry.clockInAt.toISOString(),
      clockOutAt: entry.clockOutAt?.toISOString() ?? null,
      breakMinutes: entry.breakMinutes,
      workedMinutes: workedMinutes(entry),
      plannedMinutes: planned ? plannedMinutesOf(planned) : null,
      state: entry.state,
      source: entry.source,
      stationName: planned?.stationName ?? null,
      note: entry.note,
    };
  });

  const worked = totalWorkedMinutes(entries);
  const plannedTotal = plannedShifts.reduce((total, s) => total + plannedMinutesOf(s), 0);
  const comparison = comparePlanned(plannedTotal, worked);

  const [employment] = await db
    .select()
    .from(employments)
    .where(and(eq(employments.userId, userId), isNull(employments.validTo)));

  let corridor: { minMinutes: number; maxMinutes: number } | null = null;
  if (employment && hasHoursTarget(employment.employmentType as EmploymentType) && employment.pensumPercent) {
    const days =
      Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    corridor = periodCorridor(await currentPolicy(db), Number(employment.pensumPercent), days);
  }

  return {
    from,
    to,
    rows,
    workedMinutes: comparison.workedMinutes,
    plannedMinutes: comparison.plannedMinutes,
    varianceMinutes: comparison.varianceMinutes,
    corridor,
    openEntryId: entries.find((e) => e.state === 'OPEN')?.id ?? null,
  };
}

/** Everything a manager still has to look at, oldest first. */
export async function listPendingEntries(db: AppDatabase) {
  const rows = await db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      displayName: users.displayName,
      businessDate: timeEntries.businessDate,
      clockInAt: timeEntries.clockInAt,
      clockOutAt: timeEntries.clockOutAt,
      breakMinutes: timeEntries.breakMinutes,
      state: timeEntries.state,
      source: timeEntries.source,
      note: timeEntries.note,
      shiftId: timeEntries.shiftId,
    })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(inArray(timeEntries.state, ['SUBMITTED', 'DISPUTED']))
    .orderBy(asc(timeEntries.businessDate));

  return rows.map((r) => ({
    ...r,
    clockInAt: r.clockInAt.toISOString(),
    clockOutAt: r.clockOutAt?.toISOString() ?? null,
    workedMinutes: workedMinutes({
      clockInAt: r.clockInAt,
      clockOutAt: r.clockOutAt,
      breakMinutes: r.breakMinutes,
    }),
    unplanned: r.shiftId === null,
  }));
}

export async function listRevisions(db: AppDatabase, entryId: string) {
  return db
    .select()
    .from(timeEntryRevisions)
    .where(eq(timeEntryRevisions.timeEntryId, entryId))
    .orderBy(desc(timeEntryRevisions.revisionNumber));
}

export interface StatementLine {
  readonly userId: string;
  readonly displayName: string;
  readonly employmentType: string;
  readonly pensumPercent: number | null;
  readonly targetMinMinutes: number | null;
  readonly targetMaxMinutes: number | null;
  readonly plannedMinutes: number;
  readonly workedMinutes: number;
  readonly absenceDays: number;
  readonly unapproved: number;
}

/**
 * The month, per person: planned, worked, and the corridor beside them.
 *
 * No balance and no money. Whether hours inside the corridor are settled by
 * salary or carried is a pay decision that has not been made, and deriving one
 * here would make it silently.
 */
export async function getMonthlyStatement(
  db: AppDatabase,
  periodId: string,
): Promise<{ period: { startsOn: string; endsOn: string; state: string }; lines: StatementLine[] }> {
  const [period] = await db.select().from(rosterPeriods).where(eq(rosterPeriods.id, periodId));
  if (!period) throw domainError('INVALID_PERIOD', 'That roster period does not exist.');

  const days =
    Math.round(
      (Date.parse(`${period.endsOn}T00:00:00Z`) - Date.parse(`${period.startsOn}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  const policy = await currentPolicy(db);

  const staff = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      employmentType: employments.employmentType,
      pensumPercent: employments.pensumPercent,
    })
    .from(users)
    .innerJoin(employments, and(eq(employments.userId, users.id), isNull(employments.validTo)))
    .where(eq(users.isActive, true))
    .orderBy(asc(users.displayName));

  const plannedRows = await db
    .select({
      userId: shifts.userId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      plannedBreakMinutes: shifts.plannedBreakMinutes,
    })
    .from(shifts)
    .where(and(eq(shifts.periodId, periodId), sql`${shifts.state} <> 'CANCELLED'`));

  const entryRows = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        gte(timeEntries.businessDate, period.startsOn),
        lte(timeEntries.businessDate, period.endsOn),
      ),
    );

  const leave = await db
    .select()
    .from(absences)
    .where(
      and(
        eq(absences.state, 'APPROVED'),
        lte(absences.startsOn, period.endsOn),
        gte(absences.endsOn, period.startsOn),
      ),
    );

  const lines: StatementLine[] = staff.map((person) => {
    const pensum = person.pensumPercent === null ? null : Number(person.pensumPercent);
    const corridor =
      hasHoursTarget(person.employmentType as EmploymentType) && pensum !== null
        ? periodCorridor(policy, pensum, days)
        : null;

    const mine = entryRows.filter((e) => e.userId === person.userId);

    return {
      userId: person.userId,
      displayName: person.displayName,
      employmentType: person.employmentType,
      pensumPercent: pensum,
      targetMinMinutes: corridor?.minMinutes ?? null,
      targetMaxMinutes: corridor?.maxMinutes ?? null,
      plannedMinutes: plannedRows
        .filter((s) => s.userId === person.userId)
        .reduce((total, s) => total + plannedMinutesOf(s), 0),
      workedMinutes: totalWorkedMinutes(mine),
      absenceDays: leave
        .filter((a) => a.userId === person.userId)
        .reduce((total, a) => {
          const start = a.startsOn < period.startsOn ? period.startsOn : a.startsOn;
          const end = a.endsOn > period.endsOn ? period.endsOn : a.endsOn;
          return (
            total +
            Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
            1
          );
        }, 0),
      unapproved: mine.filter((e) => e.state !== 'APPROVED').length,
    };
  });

  return {
    period: { startsOn: period.startsOn, endsOn: period.endsOn, state: period.state },
    lines,
  };
}

/**
 * Closing the month: freezing the hours and locking the period.
 *
 * Refused while anything is still unapproved — a statement with a disputed
 * entry in it is not a statement, it is a draft.
 */
export async function closeMonth(
  db: AppDatabase,
  periodId: string,
  managerId: string,
): Promise<void> {
  const { period, lines } = await getMonthlyStatement(db, periodId);
  if (period.state === 'LOCKED') throw domainError('INVALID_PERIOD', 'That month is already closed.');

  const unapproved = lines.reduce((total, line) => total + line.unapproved, 0);
  if (unapproved > 0) {
    throw domainError('VALIDATION_FAILED', `${unapproved} time entries are still unapproved.`);
  }

  await db.transaction(async (tx) => {
    for (const line of lines) {
      await tx
        .insert(monthlyStatements)
        .values({
          periodId,
          userId: line.userId,
          targetMinMinutes: line.targetMinMinutes,
          targetMaxMinutes: line.targetMaxMinutes,
          plannedMinutes: line.plannedMinutes,
          workedMinutes: line.workedMinutes,
          absenceDays: line.absenceDays,
          closedBy: managerId,
        })
        .onConflictDoNothing();
    }
    await tx
      .update(rosterPeriods)
      .set({ state: 'LOCKED', lockedAt: new Date() })
      .where(eq(rosterPeriods.id, periodId));
  });
}
