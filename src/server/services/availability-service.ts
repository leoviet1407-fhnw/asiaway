import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import {
  periodCorridor,
  type Corridor,
  type WorkTimePolicy,
} from '../../domain/roster/corridor';
import {
  availabilityWeight,
  hasHoursTarget,
  type AvailabilityWeight,
  type EmploymentType,
} from '../../domain/roster/availability';
import {
  availability,
  employments,
  rosterPeriods,
  workTimePolicy,
} from '../db/schema';
import type { AppDatabase } from '../db/client';

/**
 * Availability capture: the screen where an employee says which hours they can
 * work next month, and the only route by which an Aushilfe reaches the roster
 * at all.
 *
 * One window per person per day. The table permits several — a person who can
 * work lunch and late but not the middle is a real case — but the screen keeps
 * to one until someone asks, because two windows is where the UI stops being
 * three taps on a phone.
 */

/** UNAVAILABLE covers the whole day; the columns are NOT NULL, so say so. */
const WHOLE_DAY = { from: '00:00:00', to: '23:59:00' } as const;

export type AvailabilityKind = 'AVAILABLE' | 'PREFERRED' | 'UNAVAILABLE';

export interface AvailabilityDay {
  readonly onDate: string;
  readonly kind: AvailabilityKind;
  readonly fromTime: string;
  readonly toTime: string;
  readonly note: string | null;
}

export interface AvailabilityWorkspace {
  readonly period: {
    readonly id: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly days: number;
    readonly deadline: string | null;
    readonly isOpen: boolean;
  } | null;
  readonly contract: {
    readonly employmentType: EmploymentType;
    readonly pensumPercent: number | null;
    readonly weight: AvailabilityWeight;
  } | null;
  /** Null for an Aushilfe, who is owed no hours. */
  readonly corridor: (Corridor & { readonly hoursLabel: string }) | null;
  readonly days: readonly AvailabilityDay[];
  readonly defaultShiftEnd: string;
}

async function currentPolicy(db: AppDatabase): Promise<{
  policy: WorkTimePolicy;
  defaultShiftEnd: string;
}> {
  const [row] = await db
    .select()
    .from(workTimePolicy)
    .where(isNull(workTimePolicy.validTo))
    .limit(1);

  if (!row) {
    throw domainError('INVALID_WORK_TIME_POLICY', 'No work time policy is in force.');
  }
  return {
    policy: {
      weeklyHoursMinAt100: Number(row.weeklyHoursMinAt100),
      weeklyHoursMaxAt100: Number(row.weeklyHoursMaxAt100),
    },
    defaultShiftEnd: row.defaultShiftEnd.slice(0, 5),
  };
}

async function currentEmployment(db: AppDatabase, userId: string) {
  const [row] = await db
    .select()
    .from(employments)
    .where(and(eq(employments.userId, userId), isNull(employments.validTo)))
    .limit(1);
  return row ?? null;
}

/** Whole days, both ends inclusive: 01.10–31.10 is 31 days, not 30. */
function daysInclusive(startsOn: string, endsOn: string): number {
  const ms = Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function hoursLabel(corridor: Corridor): string {
  const h = (m: number) => (m / 60).toFixed(1).replace('.0', '');
  return `${h(corridor.minMinutes)}–${h(corridor.maxMinutes)} h`;
}

/**
 * The period currently collecting availability, plus everything the screen
 * needs to render itself. Returns a null period rather than throwing when
 * nothing is open — "no month to fill in yet" is a normal state, not an error.
 */
export async function getAvailabilityWorkspace(
  db: AppDatabase,
  userId: string,
): Promise<AvailabilityWorkspace> {
  const { policy, defaultShiftEnd } = await currentPolicy(db);

  const [period] = await db
    .select()
    .from(rosterPeriods)
    .where(eq(rosterPeriods.state, 'AVAILABILITY_OPEN'))
    .orderBy(asc(rosterPeriods.startsOn))
    .limit(1);

  const employment = await currentEmployment(db, userId);
  const pensum = employment?.pensumPercent == null ? null : Number(employment.pensumPercent);

  let corridor: (Corridor & { hoursLabel: string }) | null = null;
  if (period && employment && hasHoursTarget(employment.employmentType) && pensum !== null) {
    const c = periodCorridor(policy, pensum, daysInclusive(period.startsOn, period.endsOn));
    corridor = { ...c, hoursLabel: hoursLabel(c) };
  }

  const days = period
    ? await db
        .select({
          onDate: availability.onDate,
          kind: availability.kind,
          fromTime: availability.fromTime,
          toTime: availability.toTime,
          note: availability.note,
        })
        .from(availability)
        .where(and(eq(availability.userId, userId), eq(availability.periodId, period.id)))
        .orderBy(asc(availability.onDate))
    : [];

  return {
    period: period
      ? {
          id: period.id,
          startsOn: period.startsOn,
          endsOn: period.endsOn,
          days: daysInclusive(period.startsOn, period.endsOn),
          deadline: period.availabilityDeadline?.toISOString() ?? null,
          isOpen: !isPastDeadline(period.availabilityDeadline),
        }
      : null,
    contract: employment
      ? {
          employmentType: employment.employmentType,
          pensumPercent: pensum,
          weight: availabilityWeight(employment.employmentType),
        }
      : null,
    corridor,
    days: days.map((d) => ({
      onDate: d.onDate,
      kind: d.kind as AvailabilityKind,
      fromTime: d.fromTime.slice(0, 5),
      toTime: d.toTime.slice(0, 5),
      note: d.note,
    })),
    defaultShiftEnd,
  };
}

function isPastDeadline(deadline: Date | null): boolean {
  return deadline !== null && deadline.getTime() <= Date.now();
}

export interface SetDayInput {
  readonly userId: string;
  readonly onDate: string;
  readonly kind: AvailabilityKind;
  /** Ignored when kind is UNAVAILABLE. */
  readonly fromTime?: string;
  readonly toTime?: string;
  readonly note?: string | null;
}

/**
 * Records what one person says about one day, replacing whatever they said
 * before. Rewriting rather than appending is deliberate: an employee changing
 * their mind should not leave two contradictory rows for the planner to
 * reconcile. The audit trail of who said what and when lives in audit_events.
 */
export async function setDayAvailability(db: AppDatabase, input: SetDayInput): Promise<void> {
  const period = await openPeriodFor(db, input.onDate);

  const from = input.kind === 'UNAVAILABLE' ? WHOLE_DAY.from : normaliseTime(input.fromTime);
  const to = input.kind === 'UNAVAILABLE' ? WHOLE_DAY.to : normaliseTime(input.toTime);

  if (to <= from) {
    throw domainError('VALIDATION_FAILED', 'The end of the window must be after its start.');
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(availability)
      .where(and(eq(availability.userId, input.userId), eq(availability.onDate, input.onDate)));

    await tx.insert(availability).values({
      userId: input.userId,
      periodId: period.id,
      onDate: input.onDate,
      fromTime: from,
      toTime: to,
      kind: input.kind,
      note: input.note?.trim() ? input.note.trim() : null,
    });
  });
}

/** Withdraws a day's entry entirely: "I have not said anything about this day." */
export async function clearDayAvailability(
  db: AppDatabase,
  userId: string,
  onDate: string,
): Promise<void> {
  await openPeriodFor(db, onDate);
  await db
    .delete(availability)
    .where(and(eq(availability.userId, userId), eq(availability.onDate, onDate)));
}

/**
 * The period a date belongs to, provided it is still accepting submissions.
 *
 * Checked on every write rather than trusted from the client: the screen was
 * rendered before the deadline, and the submission may arrive after it.
 */
async function openPeriodFor(db: AppDatabase, onDate: string) {
  const [period] = await db
    .select()
    .from(rosterPeriods)
    .where(
      and(
        eq(rosterPeriods.state, 'AVAILABILITY_OPEN'),
        lte(rosterPeriods.startsOn, onDate),
        sql`${rosterPeriods.endsOn} >= ${onDate}`,
      ),
    )
    .limit(1);

  if (!period) {
    throw domainError('INVALID_PERIOD', 'That date is not in a month that is collecting availability.');
  }
  if (isPastDeadline(period.availabilityDeadline)) {
    throw domainError('INVALID_PERIOD', 'The deadline for this month has passed.');
  }
  return period;
}

function normaliseTime(value: string | undefined): string {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    throw domainError('VALIDATION_FAILED', 'A time must look like 17:30.');
  }
  return `${value}:00`;
}
