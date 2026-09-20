import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import {
  blocksPublish,
  validateRoster,
  type PersonContext,
  type PlannedShift,
  type RosterInput,
  type RuleCode,
  type RuleSettings,
  type Violation,
} from '../../domain/roster/rules';
import { RESTAURANT_TIME_ZONE, localMinutesIn, zonedInstant } from '../../domain/roster/time';
import type { EmploymentType } from '../../domain/roster/availability';
import {
  absences,
  availability,
  employments,
  rosterPeriods,
  rosterRules,
  shiftTemplates,
  shifts,
  stations,
  users,
} from '../db/schema';
import type { AppDatabase } from '../db/client';

/**
 * The roster: generating a month from the weekly skeleton, checking it, and
 * publishing it.
 *
 * One table holds the plan, so the station view and the person view are two
 * queries rather than two documents that can disagree. Every read here goes
 * through `shifts`.
 */

function eachDate(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  const last = Date.parse(`${endsOn}T00:00:00Z`);
  for (let t = Date.parse(`${startsOn}T00:00:00Z`); t <= last; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** ISO-8601 weekday: 1 = Monday .. 7 = Sunday. */
function isoWeekday(isoDate: string): number {
  return ((new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

async function loadPeriod(db: AppDatabase, periodId: string) {
  const [period] = await db.select().from(rosterPeriods).where(eq(rosterPeriods.id, periodId));
  if (!period) throw domainError('INVALID_PERIOD', 'That roster period does not exist.');
  return period;
}

/**
 * Fills a month from the weekly templates.
 *
 * Creates only what is missing, so running it again after the manager has
 * edited the grid adds newly-templated bands without discarding their work.
 * A template with headcount 3 produces three separate unassigned rows: an open
 * shift is how "needed, nobody on it yet" is represented, which is what R7
 * counts.
 */
export async function generatePeriod(
  db: AppDatabase,
  periodId: string,
): Promise<{ created: number; skipped: number }> {
  const period = await loadPeriod(db, periodId);
  if (period.state === 'PUBLISHED' || period.state === 'LOCKED') {
    throw domainError('INVALID_PERIOD', 'A published month cannot be regenerated.');
  }

  const templates = await db
    .select()
    .from(shiftTemplates)
    .where(
      and(
        lte(shiftTemplates.effectiveFrom, period.endsOn),
        or(isNull(shiftTemplates.effectiveTo), gte(shiftTemplates.effectiveTo, period.startsOn)),
      ),
    );

  const existing = await db
    .select({
      onDate: shifts.onDate,
      stationId: shifts.stationId,
      startsAt: shifts.startsAt,
    })
    .from(shifts)
    .where(eq(shifts.periodId, periodId));

  const seen = new Set(
    existing.map((s) => `${s.onDate}|${s.stationId}|${s.startsAt.toISOString()}`),
  );

  const rows: (typeof shifts.$inferInsert)[] = [];
  let skipped = 0;

  for (const onDate of eachDate(period.startsOn, period.endsOn)) {
    const weekday = isoWeekday(onDate);
    for (const template of templates) {
      if (template.weekday !== weekday) continue;
      if (template.effectiveFrom > onDate) continue;
      if (template.effectiveTo && template.effectiveTo < onDate) continue;
      if (template.staffingPolicy === 'CLOSED') continue;

      const startsAt = zonedInstant(onDate, template.startsAt.slice(0, 5), RESTAURANT_TIME_ZONE);
      let endsAt = zonedInstant(onDate, template.endsAt.slice(0, 5), RESTAURANT_TIME_ZONE);
      // A band that reads 18:00–00:30 ends on the following day.
      if (endsAt <= startsAt) {
        endsAt = zonedInstant(
          new Date(Date.parse(`${onDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
          template.endsAt.slice(0, 5),
          RESTAURANT_TIME_ZONE,
        );
      }

      const key = `${onDate}|${template.stationId}|${startsAt.toISOString()}`;
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);

      for (let n = 0; n < template.headcount; n += 1) {
        rows.push({
          periodId,
          onDate,
          stationId: template.stationId,
          userId: null,
          startsAt,
          endsAt,
          plannedBreakMinutes: template.breakMinutes,
          roleLabel: template.roleLabel,
          staffingPolicy: template.staffingPolicy,
          state: 'DRAFT',
        });
      }
    }
  }

  if (rows.length > 0) await db.insert(shifts).values(rows);
  return { created: rows.length, skipped };
}

async function loadRuleSettings(db: AppDatabase): Promise<RuleSettings> {
  const rows = await db.select().from(rosterRules);
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    settings[row.code] = {
      severity: row.severity,
      isEnabled: row.isEnabled,
      config: (row.config ?? {}) as Record<string, unknown>,
    };
  }
  return settings as RuleSettings;
}

/** Everything the validator needs, assembled from the database in one place. */
export async function loadRosterInput(db: AppDatabase, periodId: string): Promise<RosterInput> {
  const period = await loadPeriod(db, periodId);

  const planned = await db
    .select({
      id: shifts.id,
      onDate: shifts.onDate,
      userId: shifts.userId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      plannedBreakMinutes: shifts.plannedBreakMinutes,
      state: shifts.state,
      acknowledgedAt: shifts.acknowledgedAt,
      stationCode: stations.code,
      stationPolicy: stations.staffingPolicy,
      shiftPolicy: shifts.staffingPolicy,
    })
    .from(shifts)
    .innerJoin(stations, eq(stations.id, shifts.stationId))
    .where(and(eq(shifts.periodId, periodId), sql`${shifts.state} <> 'CANCELLED'`));

  const shiftList: PlannedShift[] = planned.map((s) => ({
    id: s.id,
    onDate: s.onDate,
    stationCode: s.stationCode,
    // The band's own answer wins; the station's is the default.
    stationPolicy: s.shiftPolicy ?? s.stationPolicy,
    userId: s.userId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    plannedBreakMinutes: s.plannedBreakMinutes,
    isPublished: s.state === 'PUBLISHED',
    acknowledged: s.acknowledgedAt !== null,
  }));

  const assigned = [...new Set(shiftList.map((s) => s.userId).filter((id): id is string => id !== null))];

  const people: PersonContext[] = [];
  if (assigned.length > 0) {
    const contracts = await db
      .select({
        userId: users.id,
        displayName: users.displayName,
        employmentType: employments.employmentType,
        pensumPercent: employments.pensumPercent,
      })
      .from(users)
      .innerJoin(
        employments,
        and(eq(employments.userId, users.id), isNull(employments.validTo)),
      )
      .where(inArray(users.id, assigned));

    const windows = await db
      .select()
      .from(availability)
      .where(and(inArray(availability.userId, assigned), eq(availability.periodId, periodId)));

    const leave = await db
      .select()
      .from(absences)
      .where(
        and(
          inArray(absences.userId, assigned),
          eq(absences.state, 'APPROVED'),
          lte(absences.startsOn, period.endsOn),
          gte(absences.endsOn, period.startsOn),
        ),
      );

    for (const contract of contracts) {
      people.push({
        userId: contract.userId,
        displayName: contract.displayName,
        employmentType: contract.employmentType as EmploymentType,
        pensumPercent: contract.pensumPercent === null ? null : Number(contract.pensumPercent),
        availability: windows
          .filter((w) => w.userId === contract.userId)
          .map((w) => ({
            onDate: w.onDate,
            fromMinutes: toMinutes(w.fromTime),
            toMinutes: toMinutes(w.toTime),
            kind: w.kind,
          })),
        absences: leave
          .filter((a) => a.userId === contract.userId)
          .map((a) => ({ startsOn: a.startsOn, endsOn: a.endsOn })),
      });
    }
  }

  const policy = await loadPolicy(db);

  return {
    periodDays:
      Math.round(
        (Date.parse(`${period.endsOn}T00:00:00Z`) - Date.parse(`${period.startsOn}T00:00:00Z`)) /
          86_400_000,
      ) + 1,
    timeZone: RESTAURANT_TIME_ZONE,
    shifts: shiftList,
    people,
    policy,
    rules: await loadRuleSettings(db),
  };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

async function loadPolicy(db: AppDatabase) {
  const { workTimePolicy } = await import('../db/schema');
  const [row] = await db.select().from(workTimePolicy).where(isNull(workTimePolicy.validTo));
  if (!row) throw domainError('INVALID_WORK_TIME_POLICY', 'No work time policy is in force.');
  return {
    weeklyHoursMinAt100: Number(row.weeklyHoursMinAt100),
    weeklyHoursMaxAt100: Number(row.weeklyHoursMaxAt100),
  };
}

export async function validatePeriod(db: AppDatabase, periodId: string): Promise<Violation[]> {
  return validateRoster(await loadRosterInput(db, periodId));
}

/** Puts someone on a shift, or takes them off it and leaves it open. */
export async function assignShift(
  db: AppDatabase,
  shiftId: string,
  userId: string | null,
): Promise<void> {
  const [shift] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
  if (!shift) throw domainError('VALIDATION_FAILED', 'That shift does not exist.');

  await db
    .update(shifts)
    .set({
      userId,
      // A reassignment is a different person's shift: whatever the previous
      // assignee confirmed no longer applies.
      acknowledgedAt: null,
      revision: shift.revision + 1,
      updatedAt: new Date(),
    })
    .where(eq(shifts.id, shiftId));
}

/**
 * Publishes a month, unless something blocks it.
 *
 * The validator runs here rather than only in the UI: the grid was rendered
 * from a roster that may have changed since, and a publish is the point at
 * which the plan becomes something people arrange their lives around.
 */
export async function publishPeriod(
  db: AppDatabase,
  periodId: string,
  publishedBy: string,
): Promise<{ published: boolean; violations: Violation[] }> {
  const period = await loadPeriod(db, periodId);
  if (period.state === 'LOCKED') {
    throw domainError('INVALID_PERIOD', 'A locked month cannot be published again.');
  }

  const violations = await validatePeriod(db, periodId);
  if (blocksPublish(violations)) return { published: false, violations };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(shifts)
      .set({ state: 'PUBLISHED', updatedAt: now })
      .where(and(eq(shifts.periodId, periodId), eq(shifts.state, 'DRAFT')));

    await tx
      .update(rosterPeriods)
      .set({ state: 'PUBLISHED', publishedAt: now, publishedBy })
      .where(eq(rosterPeriods.id, periodId));
  });

  return { published: true, violations };
}

/** The assignee confirming they have seen it. Nobody can acknowledge for another. */
export async function acknowledgeShift(
  db: AppDatabase,
  shiftId: string,
  userId: string,
): Promise<void> {
  const updated = await db
    .update(shifts)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(shifts.id, shiftId), eq(shifts.userId, userId), eq(shifts.state, 'PUBLISHED')))
    .returning({ id: shifts.id });

  if (updated.length === 0) {
    throw domainError('FORBIDDEN', 'That is not a published shift of yours.');
  }
}

export interface MyShift {
  readonly id: string;
  readonly onDate: string;
  readonly stationName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly breakMinutes: number;
  readonly roleLabel: string | null;
  readonly acknowledged: boolean;
}

/** One person's published plan — the person view of the same single table. */
export async function getMySchedule(
  db: AppDatabase,
  userId: string,
  fromDate: string,
): Promise<MyShift[]> {
  const rows = await db
    .select({
      id: shifts.id,
      onDate: shifts.onDate,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      breakMinutes: shifts.plannedBreakMinutes,
      roleLabel: shifts.roleLabel,
      acknowledgedAt: shifts.acknowledgedAt,
      stationName: stations.nameDe,
    })
    .from(shifts)
    .innerJoin(stations, eq(stations.id, shifts.stationId))
    .where(
      and(
        eq(shifts.userId, userId),
        eq(shifts.state, 'PUBLISHED'),
        gte(shifts.onDate, fromDate),
      ),
    )
    .orderBy(asc(shifts.startsAt));

  return rows.map((r) => ({
    id: r.id,
    onDate: r.onDate,
    stationName: r.stationName,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    breakMinutes: r.breakMinutes,
    roleLabel: r.roleLabel,
    acknowledged: r.acknowledgedAt !== null,
  }));
}

export interface GridShift {
  readonly id: string;
  readonly onDate: string;
  readonly stationCode: string;
  readonly userId: string | null;
  readonly from: string;
  readonly to: string;
  readonly roleLabel: string | null;
  /** The band's effective policy: SELF_SERVE bands need nobody assigned. */
  readonly policy: string;
  readonly acknowledged: boolean;
}

export interface RosterGrid {
  readonly period: {
    readonly id: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly state: string;
  };
  readonly dates: readonly string[];
  readonly stations: readonly {
    readonly code: string;
    readonly name: string;
    readonly policy: string;
  }[];
  readonly shifts: readonly GridShift[];
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    readonly employmentType: string;
    readonly pensumPercent: number | null;
  }[];
  readonly violations: readonly Violation[];
  readonly canPublish: boolean;
}

/**
 * The manager's grid: stations down, days across — the same shape as the paper
 * plan, because that layout works and the team can read it. The difference is
 * that this one is a query, so it cannot disagree with the person view.
 */
export async function getRosterGrid(db: AppDatabase, periodId: string): Promise<RosterGrid> {
  const period = await loadPeriod(db, periodId);

  const planned = await db
    .select({
      id: shifts.id,
      onDate: shifts.onDate,
      userId: shifts.userId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      roleLabel: shifts.roleLabel,
      acknowledgedAt: shifts.acknowledgedAt,
      stationCode: stations.code,
      stationPolicy: stations.staffingPolicy,
      shiftPolicy: shifts.staffingPolicy,
    })
    .from(shifts)
    .innerJoin(stations, eq(stations.id, shifts.stationId))
    .where(and(eq(shifts.periodId, periodId), sql`${shifts.state} <> 'CANCELLED'`))
    .orderBy(asc(shifts.onDate), asc(shifts.startsAt));

  const stationRows = await db
    .select()
    .from(stations)
    .where(eq(stations.isActive, true))
    .orderBy(asc(stations.sortOrder));

  const staff = await db
    .select({
      id: users.id,
      name: users.displayName,
      employmentType: employments.employmentType,
      pensumPercent: employments.pensumPercent,
    })
    .from(users)
    .innerJoin(employments, and(eq(employments.userId, users.id), isNull(employments.validTo)))
    .where(eq(users.isActive, true))
    .orderBy(asc(users.displayName));

  const violations = await validatePeriod(db, periodId);

  return {
    period: {
      id: period.id,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      state: period.state,
    },
    dates: eachDate(period.startsOn, period.endsOn),
    stations: stationRows.map((s) => ({
      code: s.code,
      name: s.nameDe,
      policy: s.staffingPolicy,
    })),
    shifts: planned.map((s) => ({
      id: s.id,
      onDate: s.onDate,
      stationCode: s.stationCode,
      userId: s.userId,
      from: hhmmIn(s.startsAt),
      to: hhmmIn(s.endsAt),
      roleLabel: s.roleLabel,
      policy: s.shiftPolicy ?? s.stationPolicy,
      acknowledged: s.acknowledgedAt !== null,
    })),
    people: staff.map((p) => ({
      id: p.id,
      name: p.name,
      employmentType: p.employmentType,
      pensumPercent: p.pensumPercent === null ? null : Number(p.pensumPercent),
    })),
    violations,
    canPublish: !blocksPublish(violations) && period.state !== 'LOCKED',
  };
}

function hhmmIn(instant: Date): string {
  const minutes = localMinutesIn(instant, RESTAURANT_TIME_ZONE);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export type { RuleCode, Violation };
