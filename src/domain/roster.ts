/**
 * Dienstplan (staff roster) rules. Pure functions, no database.
 *
 * A shift has a real start and a real end, in minutes after midnight of its
 * date (no "END"). Times are plain numbers so a shift past midnight is simply
 * an end above 1440. See STAFF_APP_PHASE1_SPEC / the workforce plan for why.
 */

// --- Limits (Swiss ArG / L-GAV Gastgewerbe; VERIFY before relying on them) -------------
/** Minimum rest between the last end of a day and the first start of the next day. */
export const MIN_REST_MIN = 11 * 60;
/** Longest span from the first start to the last end of one day. */
export const MAX_SPAN_MIN = 14 * 60;
/** From this span on, a split shift is flagged. */
export const WARN_SPAN_MIN = 12 * 60;
/** Working days in a row: this many is a warning, more is an error. */
export const WARN_CONSECUTIVE_DAYS = 6;
/** The house basis: 100 % is a corridor of weekly hours. */
export const WEEK_HOURS_AT_100 = { min: 40, max: 42.5 } as const;
/** Default closing time (22:00) – the usual end of an evening shift. */
export const DEFAULT_CLOSING_MIN = 22 * 60;

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'ON_CALL' | 'MANAGEMENT';

export interface ServiceWindow {
  readonly fromMin: number;
  readonly toMin: number;
}

/** When a restaurant is open on a day, and how early the staff arrive. */
export interface DayHours {
  readonly closed: boolean;
  readonly lunch: ServiceWindow;
  readonly dinner: ServiceWindow;
  /** Open all day without a break (e.g. Saturday): staff may stay the whole day, as far as their hours allow. */
  readonly wholeDay: boolean;
  /** Minutes before opening that the first person / the other persons arrive. */
  readonly leadFirst: number;
  readonly leadOther: number;
}

const STANDARD_DAY: DayHours = { closed: false, lunch: { fromMin: 10 * 60 + 30, toMin: 14 * 60 + 30 }, dinner: { fromMin: 17 * 60 + 30, toMin: 22 * 60 }, wholeDay: false, leadFirst: 0, leadOther: 0 };
// Oerlikon: Mon–Fri 11:30–14:30 and 17:30–22:00, Sat 11:00–22:00, Sun closed. Staff come 30–60 min before opening.
const OERLIKON_WEEKDAY: DayHours = { closed: false, lunch: { fromMin: 11 * 60 + 30, toMin: 14 * 60 + 30 }, dinner: { fromMin: 17 * 60 + 30, toMin: 22 * 60 }, wholeDay: false, leadFirst: 60, leadOther: 30 };
const OERLIKON_SATURDAY: DayHours = { closed: false, lunch: { fromMin: 11 * 60, toMin: 14 * 60 + 30 }, dinner: { fromMin: 17 * 60 + 30, toMin: 22 * 60 }, wholeDay: true, leadFirst: 60, leadOther: 30 };

/** The opening hours of a site on a date (Winterthur keeps the standard service times). */
export function dayHoursOf(siteId: string, date: string): DayHours {
  if (siteId !== 'oerlikon') return STANDARD_DAY;
  const wd = weekdayNo(date);
  return wd <= 5 ? OERLIKON_WEEKDAY : wd === 6 ? OERLIKON_SATURDAY : { ...STANDARD_DAY, closed: true };
}

/**
 * Staff with a Pensum only enter their holiday and work the plan. Casual staff (Aushilfen)
 * enter the times they can work. The Leitung (no Pensum, not casual) enters nothing.
 */
/**
 * The current week is frozen: it was planned a week ahead and cannot be changed any more.
 * Planning starts with next week. (Staff can still ask for a change; the Leitung approves it.)
 */
export const firstPlannableWeek = (today: string): string => addDays(mondayOf(today), 7);
export const isFrozen = (date: string, today: string): boolean => date < firstPlannableWeek(today);
export const FROZEN_MESSAGE = 'Diese Woche ist gesperrt: sie ist schon geplant. Geplant wird ab der nächsten Woche.';

/** Weekday number: 1 = Monday … 7 = Sunday. */
export const weekdayNo = (iso: string): number => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Whether a person may be planned at a site on a date. \`allowed\` are the weekdays set for that
 * site; none set (undefined or empty) means every day.
 */
export const worksAtSiteOn = (allowed: readonly number[] | undefined, date: string): boolean => !allowed || allowed.length === 0 || allowed.includes(weekdayNo(date));

export const mustReportTimes = (type: EmploymentType): boolean => type === 'ON_CALL';
export const worksByPlan = (p: { employmentType: EmploymentType; pensumPercent: number | null }): boolean => (p.employmentType === 'FULL_TIME' || p.employmentType === 'PART_TIME') && p.pensumPercent !== null;

export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: 'Vollzeit',
  PART_TIME: 'Teilzeit',
  ON_CALL: 'Aushilfe',
  MANAGEMENT: 'Geschäftsleitung',
};

// --- Sites and stations ----------------------------------------------------------------
/**
 * A roster covers a SITE, not a restaurant: in Winterthur the Thai (EG) and the
 * Vietnamese (1. OG) restaurant share the same staff and one plan.
 */
export interface RosterSite {
  readonly id: string;
  readonly name: string;
  /** The restaurants (locations) belonging to this site. */
  readonly locationIds: readonly string[];
}

export const ROSTER_SITES: readonly RosterSite[] = [
  { id: 'oerlikon', name: 'Oerlikon', locationIds: ['oerlikon'] },
  { id: 'winterthur', name: 'Winterthur', locationIds: ['winti-vn', 'winti-th'] },
];

export function siteOfLocation(locationId: string): RosterSite | undefined {
  return ROSTER_SITES.find((s) => s.locationIds.includes(locationId));
}

export interface RosterStation {
  readonly name: string;
  /** Heading on the PDF. */
  readonly title: string;
  /** Background of the cells on the plan (the colours of the paper plan). */
  readonly color: string;
  readonly textColor?: string;
}

/** The stations of each site. Edit to match the restaurants. */
export const ROSTER_STATIONS: Record<string, readonly RosterStation[]> = {
  oerlikon: [
    { name: 'Service', title: 'Service', color: '#ffc000' },
    { name: 'Buffet', title: 'Buffet', color: '#a9d18e' },
    { name: 'Küche', title: 'Küche', color: '#b4d7a0' },
    { name: 'Bar', title: 'Bar', color: '#c3d0ea' },
    { name: 'Reinigung', title: 'Reinigung', color: '#ffe699' },
    { name: 'Office', title: 'Office – Administration', color: '#adb9ca' },
  ],
  winterthur: [
    { name: 'EG Thai', title: 'EG – Thai Cuisine · BUBBLE TEA · À la carte', color: '#ffc000' },
    { name: 'Buffet', title: 'LUNCH BUFFET – Self-Service', color: '#a9d18e' },
    { name: '1. OG', title: '1. OG PAVILLON – Vietnamese Cuisine', color: '#f7cbee' },
    { name: 'Sonntag OG', title: 'SONNTAG – OG – À la carte', color: '#f1b6e6' },
    { name: 'Tee & Tapioca', title: 'GREEN TEA, BLACK TEA AND TAPIOCA PEARLS', color: '#203864', textColor: '#ffffff' },
    { name: 'Reinigung', title: 'Reinigung Buffetbereich / Reiskocher', color: '#ffe699' },
    { name: 'Office', title: 'OFFICE – Administration', color: '#adb9ca' },
  ],
};

export function stationsOf(siteId: string): readonly RosterStation[] {
  return ROSTER_STATIONS[siteId] ?? [];
}

export function stationColor(siteId: string, station: string): string {
  return stationsOf(siteId).find((s) => s.name === station)?.color ?? '#e3e1df';
}

/** A shift that starts before this belongs to the Lunch column on the plan, otherwise to Dinner. */
export const LUNCH_CUTOFF_MIN = 13 * 60 + 30;

export function isLunch(startMin: number): boolean {
  return startMin < LUNCH_CUTOFF_MIN;
}

/** One-tap starting points when adding a shift. */
export const SHIFT_PRESETS: readonly { label: string; start: string; end: string }[] = [
  { label: 'Lunch', start: '10:30', end: '14:30' },
  { label: 'Abend', start: '17:30', end: '22:00' },
  { label: 'Durchgehend', start: '14:00', end: '22:00' },
  { label: 'Ganzer Tag', start: '10:30', end: '22:00' },
];

// --- Time helpers ------------------------------------------------------------------------
/** "10:30" or "10.30" → 630; null when it is not a time. */
export function parseTime(input: string): number | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(input);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 29 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function formatHours(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** The Monday of the week containing the date (YYYY-MM-DD). */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const back = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

// --- Shifts ---------------------------------------------------------------------------------
export interface Shift {
  readonly id: string;
  readonly userId: string | null;
  readonly date: string;
  readonly startMin: number;
  readonly endMin: number;
  readonly breakMin: number;
  readonly station: string;
  readonly roleLabel: string | null;
}

/**
 * The break every shift has by law: more than 5.5 h = 15 min, more than 7 h = 30 min, more than 9 h = 60 min.
 * It is not fixed in time: staff take it whenever they want during the shift.
 */
export function requiredBreakMin(startMin: number, endMin: number): number {
  const len = endMin - startMin;
  return len > 9 * 60 ? 60 : len > 7 * 60 ? 30 : len > 5.5 * 60 ? 15 : 0;
}

export function shiftNetMinutes(s: Pick<Shift, 'startMin' | 'endMin' | 'breakMin'>): number {
  return Math.max(0, s.endMin - s.startMin - s.breakMin);
}

/** Checks one shift on its own; returns a German message or null. */
export function checkShiftTimes(startMin: number, endMin: number, breakMin: number): string | null {
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 30 * 60) return 'Zeit ist ungültig.';
  if (endMin <= startMin) return 'Das Ende muss nach dem Beginn liegen.';
  if (!Number.isInteger(breakMin) || breakMin < 0 || breakMin >= endMin - startMin) return 'Pause ist ungültig.';
  if (endMin - startMin > 14 * 60) return 'Eine Schicht darf nicht länger als 14 Stunden sein.';
  return null;
}

// --- Validation -----------------------------------------------------------------------------
export interface RosterPerson {
  readonly userId: string;
  readonly name: string;
  readonly employmentType: EmploymentType;
  /** null for Aushilfen. */
  readonly pensumPercent: number | null;
}

export type AvailabilityKind = 'AVAILABLE' | 'UNAVAILABLE';

export interface AvailabilityDay {
  readonly userId: string;
  readonly date: string;
  readonly kind: AvailabilityKind;
  /** Optional time window (minutes); both null = the whole day. */
  readonly fromMin: number | null;
  readonly toMin: number | null;
}

export type AbsenceType = 'VACATION' | 'SICK' | 'OTHER';

export const ABSENCE_LABEL: Record<AbsenceType, string> = { VACATION: 'Ferien', SICK: 'Krank', OTHER: 'Abwesend' };

export interface Absence {
  readonly userId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly type: AbsenceType;
}

export interface Violation {
  readonly severity: 'error' | 'warn' | 'info';
  readonly code: string;
  readonly message: string;
  readonly userId?: string;
  readonly date?: string;
}

export interface RosterInput {
  readonly weekStart: string;
  readonly people: readonly RosterPerson[];
  readonly shifts: readonly Shift[];
  readonly availability: readonly AvailabilityDay[];
  readonly absences: readonly Absence[];
}

const weekday = (iso: string) => ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
const dm = (iso: string) => `${weekday(iso)} ${iso.slice(8)}.${iso.slice(5, 7)}.`;

/** Weekly hours target of a contract: pensum % of the 100 % corridor, in minutes. */
export function weeklyTargetCorridor(pensumPercent: number): { minMin: number; maxMin: number } {
  return {
    minMin: Math.round((pensumPercent / 100) * WEEK_HOURS_AT_100.min * 60),
    maxMin: Math.round((pensumPercent / 100) * WEEK_HOURS_AT_100.max * 60),
  };
}

export function personWeekMinutes(shifts: readonly Shift[], userId: string): number {
  return shifts.filter((s) => s.userId === userId).reduce((sum, s) => sum + shiftNetMinutes(s), 0);
}

/** Every problem in a week's plan. Errors block publishing; warnings and infos do not. */
export function validateRoster(input: RosterInput): Violation[] {
  const out: Violation[] = [];
  const byId = new Map(input.people.map((p) => [p.userId, p]));
  const assigned = input.shifts.filter((s) => s.userId !== null);

  for (const s of input.shifts.filter((x) => x.userId === null)) {
    out.push({ severity: 'warn', code: 'OPEN_SHIFT', date: s.date, message: `${dm(s.date)} ${formatTime(s.startMin)}–${formatTime(s.endMin)} ${s.station}: niemand eingeteilt.` });
  }

  for (const person of input.people) {
    const mine = assigned.filter((s) => s.userId === person.userId).sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
    const byDate = new Map<string, Shift[]>();
    for (const s of mine) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

    for (const [date, list] of byDate) {
      // Overlaps on the same day
      for (let i = 1; i < list.length; i++) {
        if (list[i]!.startMin < list[i - 1]!.endMin) {
          out.push({ severity: 'error', code: 'OVERLAP', userId: person.userId, date, message: `${person.name}, ${dm(date)}: zwei Schichten überschneiden sich.` });
        }
      }
      // Span of the day (first start to last end)
      const span = Math.max(...list.map((s) => s.endMin)) - Math.min(...list.map((s) => s.startMin));
      if (span > MAX_SPAN_MIN) {
        out.push({ severity: 'error', code: 'SPAN', userId: person.userId, date, message: `${person.name}, ${dm(date)}: ${formatHours(span)} zwischen Beginn und Ende (max. ${MAX_SPAN_MIN / 60} h).` });
      } else if (span > WARN_SPAN_MIN) {
        out.push({ severity: 'warn', code: 'LONG_SPAN', userId: person.userId, date, message: `${person.name}, ${dm(date)}: lange Spanne von ${formatHours(span)} (geteilte Schicht).` });
      }
      // Breaks by length of each shift
      for (const s of list) {
        const len = s.endMin - s.startMin;
        const need = requiredBreakMin(s.startMin, s.endMin);
        if (s.breakMin < need) {
          out.push({ severity: 'warn', code: 'BREAK', userId: person.userId, date, message: `${person.name}, ${dm(date)}: bei ${formatHours(len)} Schicht sind mindestens ${need} Min. Pause nötig.` });
        }
      }
    }

    // Rest between the last end of a day and the first start of the next
    const dates = [...byDate.keys()].sort();
    for (let i = 1; i < dates.length; i++) {
      const prev = dates[i - 1]!;
      const next = dates[i]!;
      if (dayNumber(next) - dayNumber(prev) !== 1) continue;
      const prevEnd = Math.max(...byDate.get(prev)!.map((s) => s.endMin));
      const nextStart = Math.min(...byDate.get(next)!.map((s) => s.startMin));
      const rest = 24 * 60 - prevEnd + nextStart;
      if (rest < MIN_REST_MIN) {
        out.push({ severity: 'error', code: 'REST', userId: person.userId, date: next, message: `${person.name}: nur ${formatHours(rest)} Ruhezeit vor ${dm(next)} (min. ${MIN_REST_MIN / 60} h).` });
      }
    }

    // Working days in a row
    let run = 0;
    let runStart = '';
    for (const d of weekDates(input.weekStart)) {
      if (byDate.has(d)) {
        run += 1;
        if (run === 1) runStart = d;
        if (run === WARN_CONSECUTIVE_DAYS) {
          out.push({ severity: 'warn', code: 'CONSECUTIVE', userId: person.userId, date: d, message: `${person.name}: ${run} Arbeitstage in Folge (ab ${dm(runStart)}).` });
        }
        if (run > WARN_CONSECUTIVE_DAYS) {
          out.push({ severity: 'error', code: 'CONSECUTIVE', userId: person.userId, date: d, message: `${person.name}: ${run} Arbeitstage in Folge – ein freier Tag fehlt.` });
        }
      } else run = 0;
    }

    // Absences, availability
    for (const date of dates) {
      const absence = input.absences.find((a) => a.userId === person.userId && a.startDate <= date && date <= a.endDate);
      if (absence) {
        out.push({ severity: 'error', code: 'ABSENCE', userId: person.userId, date, message: `${person.name}, ${dm(date)}: eingeteilt, obwohl ${ABSENCE_LABEL[absence.type]}.` });
      }
      const av = input.availability.find((a) => a.userId === person.userId && a.date === date);
      const list = byDate.get(date)!;
      if (person.employmentType === 'ON_CALL') {
        if (!av) {
          out.push({ severity: 'warn', code: 'NO_OFFER', userId: person.userId, date, message: `${person.name} (Aushilfe), ${dm(date)}: noch nicht bestätigt (keine Verfügbarkeit gemeldet).` });
        } else if (av.kind === 'UNAVAILABLE') {
          out.push({ severity: 'error', code: 'UNAVAILABLE', userId: person.userId, date, message: `${person.name} (Aushilfe), ${dm(date)}: hat sich als nicht verfügbar gemeldet.` });
        } else if (av.fromMin !== null && av.toMin !== null && list.some((s) => s.startMin < av.fromMin! || s.endMin > av.toMin!)) {
          out.push({ severity: 'error', code: 'OUTSIDE_OFFER', userId: person.userId, date, message: `${person.name} (Aushilfe), ${dm(date)}: ausserhalb der gemeldeten Zeit ${formatTime(av.fromMin)}–${formatTime(av.toMin)}.` });
        }
      } else if (av?.kind === 'UNAVAILABLE') {
        out.push({ severity: 'warn', code: 'UNAVAILABLE', userId: person.userId, date, message: `${person.name}, ${dm(date)}: wollte frei haben.` });
      }
    }

    // Weekly hours against the contract
    const minutes = personWeekMinutes(input.shifts, person.userId);
    if (person.pensumPercent !== null && person.employmentType !== 'ON_CALL') {
      const { minMin, maxMin } = weeklyTargetCorridor(person.pensumPercent);
      if (minutes < minMin) out.push({ severity: 'warn', code: 'UNDER', userId: person.userId, message: `${person.name} (${person.pensumPercent} %): ${formatHours(minutes)} geplant, Ziel ${formatHours(minMin)}–${formatHours(maxMin)}.` });
      else if (minutes > maxMin) out.push({ severity: 'warn', code: 'OVER', userId: person.userId, message: `${person.name} (${person.pensumPercent} %): ${formatHours(minutes)} geplant, Ziel ${formatHours(minMin)}–${formatHours(maxMin)}.` });
    }
  }

  // Shifts for someone who is not in the roster of this location
  for (const s of assigned) {
    if (!byId.has(s.userId!)) out.push({ severity: 'error', code: 'UNKNOWN_PERSON', date: s.date, message: `${dm(s.date)}: Schicht für eine Person, die nicht im Team ist.` });
  }
  return out;
}

export function hasBlockingViolation(violations: readonly Violation[]): boolean {
  return violations.some((v) => v.severity === 'error');
}

// --- Planning a month ahead ---------------------------------------------------------------
/**
 * Availability and holidays are due one month ahead, so the plan can be made.
 * Staff can enter or change a day only if it is at least this many days away;
 * after that only the planner can (e.g. for sick days or swaps).
 */
export const LEAD_DAYS = 28;

export function isOpenForStaff(date: string, today: string): boolean {
  return dayNumber(date) - dayNumber(today) >= LEAD_DAYS;
}

/** The first date staff can still change. */
export function firstOpenDate(today: string): string {
  return addDays(today, LEAD_DAYS);
}

/** "2026-12" for the month that is due next: the month of the first open date. */
export function dueMonth(today: string): string {
  return firstOpenDate(today).slice(0, 7);
}

export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function weekdayShort(iso: string, lang: 'de' | 'en' = 'de'): string {
  const names = lang === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return names[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
}

export type AbsenceStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED';

export const ABSENCE_STATUS_LABEL: Record<AbsenceStatus, string> = {
  REQUESTED: 'Angefragt',
  APPROVED: 'Genehmigt',
  REJECTED: 'Abgelehnt',
};
