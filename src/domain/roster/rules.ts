import { corridorVerdict, periodCorridor, type WorkTimePolicy } from './corridor';
import { hasHoursTarget, type EmploymentType } from './availability';
import { localMinutesIn } from './time';

/**
 * The roster validator: a pure function over a proposed month.
 *
 * This is the manager's second pair of eyes, and the reason the project is
 * worth building. Every rule here corresponds to something the September 2026
 * Arbeitsplan could not check — a cleaning duty assigned to someone not on
 * shift, six consecutive days, a station nobody was standing in — and each one
 * names the finding it comes from.
 *
 * No database, no clock, no I/O: the same input always gives the same result,
 * which is what makes a rule engine trustworthy enough to block a publish.
 *
 * Thresholds arrive as configuration (see the roster_rules table) rather than
 * being written in here, because the legal reading behind R2–R5 is still open
 * and correcting a number must not require a deployment.
 */

export type RuleCode =
  | 'R2_MIN_REST'
  | 'R3_MAX_DAILY_SPAN'
  | 'R4_MAX_CONSECUTIVE'
  | 'R5_BREAKS'
  | 'R6_NO_OVERLAP'
  | 'R7_UNDERSTAFFED'
  | 'R8A_ON_CALL_OUTSIDE'
  | 'R8B_AGAINST_PREF'
  | 'R8C_ON_ABSENCE'
  | 'R9_CORRIDOR'
  | 'R10_SPLIT_FAIRNESS'
  | 'R11_UNACKNOWLEDGED';

export type Severity = 'BLOCK' | 'WARN' | 'INFO';

export interface RuleSetting {
  readonly severity: Severity;
  readonly isEnabled: boolean;
  readonly config: Record<string, unknown>;
}

export type RuleSettings = Readonly<Partial<Record<RuleCode, RuleSetting>>>;

export interface PlannedShift {
  readonly id: string;
  readonly onDate: string;
  readonly stationCode: string;
  readonly stationPolicy: 'STAFFED' | 'SELF_SERVE' | 'CLOSED';
  readonly userId: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly plannedBreakMinutes: number;
  readonly isPublished: boolean;
  readonly acknowledged: boolean;
}

export interface AvailabilityWindow {
  readonly onDate: string;
  readonly fromMinutes: number;
  readonly toMinutes: number;
  readonly kind: 'AVAILABLE' | 'PREFERRED' | 'UNAVAILABLE';
}

export interface PersonContext {
  readonly userId: string;
  readonly displayName: string;
  readonly employmentType: EmploymentType;
  readonly pensumPercent: number | null;
  readonly availability: readonly AvailabilityWindow[];
  /** Approved absences only; a request that was never granted binds nobody. */
  readonly absences: readonly { readonly startsOn: string; readonly endsOn: string }[];
}

export interface RosterInput {
  readonly periodDays: number;
  /** The restaurant's wall clock. Shifts are stored as instants; a roster is read in local time. */
  readonly timeZone: string;
  readonly shifts: readonly PlannedShift[];
  readonly people: readonly PersonContext[];
  readonly policy: WorkTimePolicy;
  readonly rules: RuleSettings;
}

export interface Violation {
  readonly code: RuleCode;
  readonly severity: Severity;
  readonly userId: string | null;
  readonly onDate: string | null;
  readonly shiftIds: readonly string[];
  readonly message: string;
}

const MINUTE = 60_000;

function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MINUTE);
}

function duration(shift: PlannedShift): number {
  return minutesBetween(shift.startsAt, shift.endsAt);
}

/**
 * A shift's wall-clock window, in minutes since local midnight on its own date.
 *
 * The end is carried past 1440 when a Saturday finishes after midnight, so that
 * comparisons against an availability window stay ordinary arithmetic. Read from
 * the clock rather than derived from the elapsed duration, because on the night
 * the clocks change those two disagree by an hour.
 */
function wallClockWindow(shift: PlannedShift, timeZone: string): { from: number; to: number } {
  const from = localMinutesIn(shift.startsAt, timeZone);
  const end = localMinutesIn(shift.endsAt, timeZone);
  return { from, to: end <= from ? end + 1440 : end };
}

function hhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1).replace('.0', '')} h`;
}

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function groupByDate(shifts: readonly PlannedShift[]): Map<string, PlannedShift[]> {
  const byDate = new Map<string, PlannedShift[]>();
  for (const shift of shifts) {
    const list = byDate.get(shift.onDate);
    if (list) list.push(shift);
    else byDate.set(shift.onDate, [shift]);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
  return byDate;
}

/**
 * Validates a whole proposed month.
 *
 * Returns every violation rather than stopping at the first: a manager fixing
 * a roster wants the list, not a game of whack-a-mole. Ordered BLOCK, then
 * WARN, then INFO, so the things that stop a publish are read first.
 */
export function validateRoster(input: RosterInput): Violation[] {
  const found: Violation[] = [];
  const emit = (
    code: RuleCode,
    partial: Omit<Violation, 'code' | 'severity'>,
  ): void => {
    const setting = input.rules[code];
    if (setting && !setting.isEnabled) return;
    found.push({ code, severity: setting?.severity ?? 'WARN', ...partial });
  };
  const configFor = (code: RuleCode): Record<string, unknown> => input.rules[code]?.config ?? {};

  checkUnderstaffed(input, emit);

  for (const person of input.people) {
    const own = input.shifts.filter((s) => s.userId === person.userId && s.stationPolicy !== 'CLOSED');
    if (own.length === 0) continue;
    const byDate = groupByDate(own);

    checkOverlap(person, byDate, emit);
    checkDailySpan(person, byDate, configFor('R3_MAX_DAILY_SPAN'), emit);
    checkBreaks(person, byDate, configFor('R5_BREAKS'), emit);
    checkRest(person, byDate, configFor('R2_MIN_REST'), emit);
    checkConsecutiveDays(person, byDate, configFor('R4_MAX_CONSECUTIVE'), emit);
    checkAvailability(person, own, input.timeZone, emit);
    checkAbsence(person, own, emit);
    checkCorridor(person, own, input, emit);
    checkSplitFairness(person, byDate, configFor('R10_SPLIT_FAIRNESS'), emit);
    checkAcknowledged(person, own, emit);
  }

  const rank: Record<Severity, number> = { BLOCK: 0, WARN: 1, INFO: 2 };
  return found.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.onDate ?? '').localeCompare(b.onDate ?? ''),
  );
}

type Emit = (code: RuleCode, partial: Omit<Violation, 'code' | 'severity'>) => void;

/**
 * R7 — a station that should be staffed and has nobody on it.
 *
 * An unassigned shift is the representation of "needed, not yet filled", so
 * this is a count of open shifts rather than a search for missing rows. A
 * SELF_SERVE station ("Kellner selbst") or a CLOSED one is answered, not empty:
 * the September plan's blank 1. OG lunch rows could not make that distinction.
 */
function checkUnderstaffed(input: RosterInput, emit: Emit): void {
  for (const shift of input.shifts) {
    if (shift.userId !== null || shift.stationPolicy !== 'STAFFED') continue;
    const window = wallClockWindow(shift, input.timeZone);
    emit('R7_UNDERSTAFFED', {
      userId: null,
      onDate: shift.onDate,
      shiftIds: [shift.id],
      message: `${shift.stationCode} ${hhmm(window.from)}–${hhmm(window.to % 1440)} on ${shift.onDate} has nobody assigned.`,
    });
  }
}

/** R6 — one person cannot stand at two stations at once. */
function checkOverlap(person: PersonContext, byDate: Map<string, PlannedShift[]>, emit: Emit): void {
  for (const [onDate, list] of byDate) {
    for (let i = 1; i < list.length; i += 1) {
      const previous = list[i - 1]!;
      const current = list[i]!;
      if (current.startsAt < previous.endsAt) {
        emit('R6_NO_OVERLAP', {
          userId: person.userId,
          onDate,
          shiftIds: [previous.id, current.id],
          message: `${person.displayName} is on ${previous.stationCode} and ${current.stationCode} at the same time on ${onDate}.`,
        });
      }
    }
  }
}

/**
 * R3 — the span from first clock-in to last clock-out.
 *
 * The number that matters for a split shift: five people in September 2026 had
 * 11 h 30 spans for eight or nine hours of paid work.
 */
function checkDailySpan(
  person: PersonContext,
  byDate: Map<string, PlannedShift[]>,
  config: Record<string, unknown>,
  emit: Emit,
): void {
  const limit = num(config, 'minutes', 840);
  for (const [onDate, list] of byDate) {
    const span = minutesBetween(list[0]!.startsAt, list[list.length - 1]!.endsAt);
    if (span > limit) {
      emit('R3_MAX_DAILY_SPAN', {
        userId: person.userId,
        onDate,
        shiftIds: list.map((s) => s.id),
        message: `${person.displayName} spans ${hours(span)} on ${onDate}, over the ${hours(limit)} limit.`,
      });
    }
  }
}

/** R5 — the break a day's length earns, against what is actually planned. */
function checkBreaks(
  person: PersonContext,
  byDate: Map<string, PlannedShift[]>,
  config: Record<string, unknown>,
  emit: Emit,
): void {
  const tiers = Array.isArray(config.tiers)
    ? (config.tiers as { afterMinutes: number; breakMinutes: number }[])
    : [];
  if (tiers.length === 0) return;

  for (const [onDate, list] of byDate) {
    const worked = list.reduce((total, s) => total + duration(s), 0);
    const planned = list.reduce((total, s) => total + s.plannedBreakMinutes, 0);

    // A split shift's own gap is already a break, and a long one.
    const gap = list.length > 1
      ? minutesBetween(list[0]!.endsAt, list[list.length - 1]!.startsAt)
      : 0;

    const owed = tiers
      .filter((t) => worked > t.afterMinutes)
      .reduce((most, t) => Math.max(most, t.breakMinutes), 0);

    if (owed > 0 && planned + gap < owed) {
      emit('R5_BREAKS', {
        userId: person.userId,
        onDate,
        shiftIds: list.map((s) => s.id),
        message: `${person.displayName} works ${hours(worked)} on ${onDate} with ${planned} min break; ${owed} min is owed.`,
      });
    }
  }
}

/**
 * R2 — rest between working days.
 *
 * Compared from the end of one day's last shift to the start of the next day's
 * first, rather than between every pair of shifts: the gap inside a split shift
 * is not a rest period, it is the middle of the day, and R3 governs it.
 */
function checkRest(
  person: PersonContext,
  byDate: Map<string, PlannedShift[]>,
  config: Record<string, unknown>,
  emit: Emit,
): void {
  const limit = num(config, 'minutes', 660);
  const dates = [...byDate.keys()].sort();

  for (let i = 1; i < dates.length; i += 1) {
    const previous = byDate.get(dates[i - 1]!)!;
    const current = byDate.get(dates[i]!)!;
    const rest = minutesBetween(previous[previous.length - 1]!.endsAt, current[0]!.startsAt);
    if (rest < limit) {
      emit('R2_MIN_REST', {
        userId: person.userId,
        onDate: dates[i]!,
        shiftIds: [previous[previous.length - 1]!.id, current[0]!.id],
        message: `${person.displayName} gets ${hours(rest)} rest before ${dates[i]}, under the ${hours(limit)} minimum.`,
      });
    }
  }
}

/** R4 — consecutive working days. YEN worked six in the week of 07.09.2026. */
function checkConsecutiveDays(
  person: PersonContext,
  byDate: Map<string, PlannedShift[]>,
  config: Record<string, unknown>,
  emit: Emit,
): void {
  const limit = num(config, 'days', 6);
  const dates = [...byDate.keys()].sort();

  let run: string[] = [];
  const flush = (): void => {
    if (run.length > limit) {
      emit('R4_MAX_CONSECUTIVE', {
        userId: person.userId,
        onDate: run[0]!,
        shiftIds: [],
        message: `${person.displayName} works ${run.length} days in a row from ${run[0]} to ${run[run.length - 1]}, over the ${limit}-day limit.`,
      });
    }
    run = [];
  };

  for (const date of dates) {
    if (run.length > 0 && addDays(run[run.length - 1]!, 1) !== date) flush();
    run.push(date);
  }
  flush();
}

function covers(
  windows: readonly AvailabilityWindow[],
  shift: PlannedShift,
  timeZone: string,
): boolean {
  const { from, to } = wallClockWindow(shift, timeZone);
  return windows.some((w) => w.fromMinutes <= from && w.toMinutes >= to);
}

/**
 * R8a / R8b — the two weights an availability row carries.
 *
 * For an Aushilfe the submission is an offer and the only route onto the
 * roster, so anything outside it is an error rather than an override. For
 * everyone else the contract already obliges the hours, so it is a warning.
 */
function checkAvailability(
  person: PersonContext,
  own: readonly PlannedShift[],
  timeZone: string,
  emit: Emit,
): void {
  const binding = person.employmentType === 'ON_CALL';

  for (const shift of own) {
    const forDay = person.availability.filter((w) => w.onDate === shift.onDate);
    const unavailable = forDay.some((w) => w.kind === 'UNAVAILABLE');
    const offered = forDay.filter((w) => w.kind !== 'UNAVAILABLE');

    if (binding) {
      if (unavailable || offered.length === 0 || !covers(offered, shift, timeZone)) {
        emit('R8A_ON_CALL_OUTSIDE', {
          userId: person.userId,
          onDate: shift.onDate,
          shiftIds: [shift.id],
          message:
            offered.length === 0 && !unavailable
              ? `${person.displayName} offered no hours on ${shift.onDate} and cannot be rostered.`
              : `${person.displayName} is rostered outside the hours they offered on ${shift.onDate}.`,
        });
      }
    } else if (unavailable) {
      emit('R8B_AGAINST_PREF', {
        userId: person.userId,
        onDate: shift.onDate,
        shiftIds: [shift.id],
        message: `${person.displayName} said they cannot work on ${shift.onDate}.`,
      });
    }
  }
}

/** R8c — nobody is rostered during leave they were granted. */
function checkAbsence(person: PersonContext, own: readonly PlannedShift[], emit: Emit): void {
  for (const shift of own) {
    const absence = person.absences.find(
      (a) => a.startsOn <= shift.onDate && a.endsOn >= shift.onDate,
    );
    if (absence) {
      emit('R8C_ON_ABSENCE', {
        userId: person.userId,
        onDate: shift.onDate,
        shiftIds: [shift.id],
        message: `${person.displayName} is on approved leave from ${absence.startsOn} to ${absence.endsOn}.`,
      });
    }
  }
}

/** R9 — planned hours against the pensum corridor. Planning only, never pay. */
function checkCorridor(
  person: PersonContext,
  own: readonly PlannedShift[],
  input: RosterInput,
  emit: Emit,
): void {
  if (!hasHoursTarget(person.employmentType) || person.pensumPercent === null) return;

  const planned = own.reduce((total, s) => total + duration(s) - s.plannedBreakMinutes, 0);
  const corridor = periodCorridor(input.policy, person.pensumPercent, input.periodDays);
  const verdict = corridorVerdict(planned, corridor);
  if (verdict === 'INSIDE') return;

  emit('R9_CORRIDOR', {
    userId: person.userId,
    onDate: null,
    shiftIds: [],
    message: `${person.displayName} is planned ${hours(planned)} against a ${person.pensumPercent}% corridor of ${hours(
      corridor.minMinutes,
    )}–${hours(corridor.maxMinutes)} (${verdict.toLowerCase()}).`,
  });
}

/** R10 — split shifts concentrated on one person. EDMOND had four of five. */
function checkSplitFairness(
  person: PersonContext,
  byDate: Map<string, PlannedShift[]>,
  config: Record<string, unknown>,
  emit: Emit,
): void {
  const limit = num(config, 'maxPerWeek', 3);
  const byWeek = new Map<string, number>();

  for (const [onDate, list] of byDate) {
    if (list.length < 2) continue;
    const gap = minutesBetween(list[0]!.endsAt, list[list.length - 1]!.startsAt);
    if (gap < 60) continue; // consecutive shifts at two stations are not a split
    const monday = addDays(onDate, -((new Date(`${onDate}T00:00:00Z`).getUTCDay() + 6) % 7));
    byWeek.set(monday, (byWeek.get(monday) ?? 0) + 1);
  }

  for (const [monday, count] of byWeek) {
    if (count > limit) {
      emit('R10_SPLIT_FAIRNESS', {
        userId: person.userId,
        onDate: monday,
        shiftIds: [],
        message: `${person.displayName} has ${count} split shifts in the week of ${monday}, over ${limit}.`,
      });
    }
  }
}

/** R11 — published, but the person has not confirmed they have seen it. */
function checkAcknowledged(person: PersonContext, own: readonly PlannedShift[], emit: Emit): void {
  const pending = own.filter((s) => s.isPublished && !s.acknowledged);
  if (pending.length === 0) return;

  emit('R11_UNACKNOWLEDGED', {
    userId: person.userId,
    onDate: null,
    shiftIds: pending.map((s) => s.id),
    message: `${person.displayName} has not yet confirmed ${pending.length} published shift(s).`,
  });
}

/** A publish is refused while any BLOCK stands. */
export function blocksPublish(violations: readonly Violation[]): boolean {
  return violations.some((v) => v.severity === 'BLOCK');
}
