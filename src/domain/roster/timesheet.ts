import { domainError } from '../errors';

/**
 * Worked time, and how it compares with what was planned.
 *
 * Pure arithmetic over recorded facts. What it deliberately does NOT do is say
 * what anyone is owed: that is an interpretation under a pay rule, and no pay
 * rule has been chosen (Part 9 of the plan). Everything here is a scheduling
 * fact — how long someone was on the floor, and how far that is from the plan.
 *
 * Integer minutes throughout, for the same reason money is integer Rappen.
 */

export interface WorkedWindow {
  readonly clockInAt: Date;
  readonly clockOutAt: Date | null;
  readonly breakMinutes: number;
}

/**
 * Paid minutes for one entry: time on the floor, less the break.
 *
 * An entry still running contributes nothing. Counting it to "now" would make
 * a timesheet that changes every time it is read, and a month that never
 * settles.
 */
export function workedMinutes(entry: WorkedWindow): number {
  if (entry.clockOutAt === null) return 0;
  const gross = Math.round((entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / 60_000);
  return Math.max(0, gross - entry.breakMinutes);
}

export function totalWorkedMinutes(entries: readonly WorkedWindow[]): number {
  return entries.reduce((total, entry) => total + workedMinutes(entry), 0);
}

export interface PlannedVsWorked {
  readonly plannedMinutes: number;
  readonly workedMinutes: number;
  /** Positive where more was worked than planned. */
  readonly varianceMinutes: number;
}

export function comparePlanned(plannedMinutes: number, worked: number): PlannedVsWorked {
  return {
    plannedMinutes,
    workedMinutes: worked,
    varianceMinutes: worked - plannedMinutes,
  };
}

/**
 * Whether an entry's times are usable at all.
 *
 * Rejected here rather than only in the database so the message reaches the
 * person typing it, while they still remember what they meant.
 */
export function assertUsableWindow(clockInAt: Date, clockOutAt: Date | null, breakMinutes: number): void {
  if (breakMinutes < 0) {
    throw domainError('VALIDATION_FAILED', 'A break cannot be negative.');
  }
  if (clockOutAt === null) return;

  if (clockOutAt <= clockInAt) {
    throw domainError('VALIDATION_FAILED', 'The end of a shift must come after its start.');
  }
  const gross = Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60_000);
  // Said separately from the break check below, because "the break cannot be
  // as long as the shift" is baffling when the break is zero and the real
  // problem is that someone clocked out seconds after clocking in.
  if (gross < 1) {
    throw domainError('VALIDATION_FAILED', 'That shift is under a minute long.');
  }
  if (breakMinutes >= gross) {
    throw domainError('VALIDATION_FAILED', 'The break cannot be as long as the shift.');
  }
  // A shift longer than this is a forgotten clock-out, not a day's work. Caught
  // here because the alternative is a 19-hour entry quietly entering a month.
  if (gross > 16 * 60) {
    throw domainError('VALIDATION_FAILED', 'That is longer than 16 hours; check the clock-out.');
  }
}

export const TIME_ENTRY_STATES = ['OPEN', 'SUBMITTED', 'APPROVED', 'DISPUTED'] as const;
export type TimeEntryState = (typeof TIME_ENTRY_STATES)[number];

/**
 * OPEN ──clock out──▶ SUBMITTED ──approve──▶ APPROVED
 *                          ▲                     │
 *                          └──── correct ────────┘
 *                          │
 *                     dispute ──▶ DISPUTED ──approve──▶ APPROVED
 *
 * An approved entry can be reopened by a correction, because a payslip
 * defended with the wrong hours is worse than one corrected late.
 */
const ALLOWED: Record<TimeEntryState, TimeEntryState[]> = {
  OPEN: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'DISPUTED'],
  DISPUTED: ['APPROVED', 'SUBMITTED'],
  APPROVED: ['SUBMITTED', 'DISPUTED'],
};

export function canTransition(from: TimeEntryState, to: TimeEntryState): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: TimeEntryState, to: TimeEntryState): void {
  if (!canTransition(from, to)) {
    throw domainError(
      'ILLEGAL_TIME_ENTRY_TRANSITION',
      `A ${from.toLowerCase()} time entry cannot become ${to.toLowerCase()}.`,
    );
  }
}
