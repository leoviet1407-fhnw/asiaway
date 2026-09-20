/**
 * What a submitted availability row obliges the planner to do.
 *
 * The same row means two different things depending on the contract behind it,
 * and getting this backwards is how a casual worker ends up rostered on a day
 * they said they could not work:
 *
 *   BINDING  (ON_CALL) — an offer. An Aushilfe is owed no hours and has promised
 *                        none, so availability is the ONLY thing that puts them
 *                        on the roster. Assigning outside it is not an override,
 *                        it is an error. Rule R8a blocks it.
 *
 *   ADVISORY (FULL_TIME, PART_TIME) — a preference. The contract already obliges
 *                        the hours, so the planner may assign against it when the
 *                        week demands it. Rule R8b warns and records a reason.
 */
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'ON_CALL'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type AvailabilityWeight = 'BINDING' | 'ADVISORY';

export function availabilityWeight(employmentType: EmploymentType): AvailabilityWeight {
  return employmentType === 'ON_CALL' ? 'BINDING' : 'ADVISORY';
}

/** Whether this contract is owed a corridor at all. ON_CALL is owed nothing. */
export function hasHoursTarget(employmentType: EmploymentType): boolean {
  return employmentType !== 'ON_CALL';
}
