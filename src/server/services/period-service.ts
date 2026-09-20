import { and, asc, desc, eq, gte, lte, ne, or, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { absences, auditEvents, rosterPeriods, shifts, users } from '../db/schema';
import type { AppDatabase } from '../db/client';

/**
 * Roster periods and absence, the two things that decide what a blank row on
 * the plan means.
 *
 * The September 2026 plan had one person with no shifts and no way to say why
 * — holiday, unavailable, or overlooked were indistinguishable. An absence is
 * a state here, so a blank row can only ever mean "not needed".
 */

export const PERIOD_STATES = [
  'DRAFT',
  'AVAILABILITY_OPEN',
  'PLANNING',
  'PUBLISHED',
  'LOCKED',
] as const;
export type PeriodState = (typeof PERIOD_STATES)[number];

/** Forward only. A month does not go back to collecting once it is published. */
const ALLOWED_NEXT: Record<PeriodState, PeriodState[]> = {
  DRAFT: ['AVAILABILITY_OPEN', 'PLANNING'],
  AVAILABILITY_OPEN: ['PLANNING'],
  PLANNING: ['AVAILABILITY_OPEN', 'PUBLISHED'],
  PUBLISHED: ['PLANNING', 'LOCKED'],
  LOCKED: [],
};

export async function listPeriods(db: AppDatabase) {
  const rows = await db
    .select({
      id: rosterPeriods.id,
      startsOn: rosterPeriods.startsOn,
      endsOn: rosterPeriods.endsOn,
      state: rosterPeriods.state,
      availabilityDeadline: rosterPeriods.availabilityDeadline,
      publishedAt: rosterPeriods.publishedAt,
    })
    .from(rosterPeriods)
    .orderBy(desc(rosterPeriods.startsOn));

  // Counted with its own grouped query rather than a correlated subquery in a
  // sql`` template: that version compiled without complaint and returned 0 for
  // every period, which reads as "nothing planned yet" rather than as a bug.
  const counts = await db
    .select({ periodId: shifts.periodId, n: sql<number>`count(*)::int` })
    .from(shifts)
    .groupBy(shifts.periodId);

  const byPeriod = new Map(counts.map((c) => [c.periodId, Number(c.n)]));
  return rows.map((row) => ({ ...row, shiftCount: byPeriod.get(row.id) ?? 0 }));
}

/** Creates a month. The caller gives the first day; the last is derived. */
export async function createMonth(
  db: AppDatabase,
  firstDay: string,
  deadline: string | null,
  createdBy: string,
): Promise<string> {
  const start = new Date(`${firstDay}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.getUTCDate() !== 1) {
    throw domainError('INVALID_PERIOD', 'A month must start on the first of the month.');
  }
  const endsOn = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);

  const [clash] = await db
    .select({ id: rosterPeriods.id })
    .from(rosterPeriods)
    .where(and(lte(rosterPeriods.startsOn, endsOn), gte(rosterPeriods.endsOn, firstDay)));
  if (clash) throw domainError('INVALID_PERIOD', 'That month overlaps an existing period.');

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(rosterPeriods)
      .values({
        startsOn: firstDay,
        endsOn,
        state: 'DRAFT',
        availabilityDeadline: deadline ? new Date(deadline) : null,
      })
      .returning({ id: rosterPeriods.id });

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: createdBy,
      action: 'ROSTER_PERIOD_CREATED',
      entityType: 'ROSTER_PERIOD',
      entityId: created!.id,
      afterValue: { startsOn: firstDay, endsOn },
    });
    return created!.id;
  });

  return id;
}

export async function setPeriodState(
  db: AppDatabase,
  periodId: string,
  next: PeriodState,
  actorId: string,
): Promise<void> {
  const [period] = await db.select().from(rosterPeriods).where(eq(rosterPeriods.id, periodId));
  if (!period) throw domainError('INVALID_PERIOD', 'That roster period does not exist.');

  if (!ALLOWED_NEXT[period.state as PeriodState].includes(next)) {
    throw domainError(
      'INVALID_PERIOD',
      `A ${period.state.toLowerCase().replace('_', ' ')} month cannot move to ${next.toLowerCase().replace('_', ' ')}.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(rosterPeriods)
      .set({ state: next, ...(next === 'LOCKED' ? { lockedAt: new Date() } : {}) })
      .where(eq(rosterPeriods.id, periodId));

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: actorId,
      action: 'ROSTER_PERIOD_STATE_CHANGED',
      entityType: 'ROSTER_PERIOD',
      entityId: periodId,
      beforeValue: { state: period.state },
      afterValue: { state: next },
    });
  });
}

export async function setDeadline(
  db: AppDatabase,
  periodId: string,
  deadline: string | null,
): Promise<void> {
  await db
    .update(rosterPeriods)
    .set({ availabilityDeadline: deadline ? new Date(deadline) : null })
    .where(eq(rosterPeriods.id, periodId));
}

// ---------------------------------------------------------------------------
// Absence
// ---------------------------------------------------------------------------

export const ABSENCE_TYPES = ['VACATION', 'SICK', 'MILITARY', 'UNPAID', 'PUBLIC_HOLIDAY'] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export async function requestAbsence(
  db: AppDatabase,
  input: {
    userId: string;
    startsOn: string;
    endsOn: string;
    absenceType: AbsenceType;
    note?: string | null;
  },
): Promise<string> {
  if (input.endsOn < input.startsOn) {
    throw domainError('VALIDATION_FAILED', 'The last day cannot come before the first.');
  }

  const [overlap] = await db
    .select({ id: absences.id })
    .from(absences)
    .where(
      and(
        eq(absences.userId, input.userId),
        ne(absences.state, 'REJECTED'),
        lte(absences.startsOn, input.endsOn),
        gte(absences.endsOn, input.startsOn),
      ),
    );
  if (overlap) throw domainError('VALIDATION_FAILED', 'That overlaps a request you already have.');

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(absences)
      .values({
        userId: input.userId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        absenceType: input.absenceType,
        note: input.note?.trim() || null,
      })
      .returning({ id: absences.id });

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: input.userId,
      action: 'ABSENCE_REQUESTED',
      entityType: 'ABSENCE',
      entityId: created!.id,
      afterValue: { startsOn: input.startsOn, endsOn: input.endsOn, type: input.absenceType },
    });
    return created!.id;
  });
}

/**
 * Granting or refusing leave.
 *
 * An approved absence blocks a shift (R8c), so this is the moment the roster's
 * view of who is available actually changes.
 */
export async function decideAbsence(
  db: AppDatabase,
  absenceId: string,
  decision: 'APPROVED' | 'REJECTED',
  managerId: string,
): Promise<void> {
  const [absence] = await db.select().from(absences).where(eq(absences.id, absenceId));
  if (!absence) throw domainError('VALIDATION_FAILED', 'That request does not exist.');
  if (absence.state !== 'REQUESTED') {
    throw domainError('VALIDATION_FAILED', 'That request has already been decided.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(absences)
      .set({ state: decision, decidedBy: managerId, decidedAt: new Date() })
      .where(eq(absences.id, absenceId));

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: managerId,
      action: 'ABSENCE_DECIDED',
      entityType: 'ABSENCE',
      entityId: absenceId,
      beforeValue: { state: absence.state },
      afterValue: { state: decision },
    });
  });
}

export async function listAbsencesFor(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(absences)
    .where(eq(absences.userId, userId))
    .orderBy(desc(absences.startsOn));
}

/** Everything awaiting a decision, oldest request first. */
export async function listPendingAbsences(db: AppDatabase) {
  return db
    .select({
      id: absences.id,
      userId: absences.userId,
      displayName: users.displayName,
      startsOn: absences.startsOn,
      endsOn: absences.endsOn,
      absenceType: absences.absenceType,
      note: absences.note,
      requestedAt: absences.requestedAt,
    })
    .from(absences)
    .innerJoin(users, eq(users.id, absences.userId))
    .where(eq(absences.state, 'REQUESTED'))
    .orderBy(asc(absences.requestedAt));
}
