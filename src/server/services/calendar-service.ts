import { randomBytes } from 'node:crypto';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { ROSTER_SITES, addDays, formatTime, mondayOf } from '../../domain/roster';
import { todayIso } from '../../lib/dates';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { locations, rosterWeeks, shifts, users } from '../db/schema';

/**
 * A person's shifts as a calendar feed (iCalendar), for subscribing in Apple Calendar or
 * Google Calendar. The calendar app fetches the link again by itself, so published changes
 * show up without doing anything. The link holds a long random token instead of a login.
 */

const newToken = () => randomBytes(24).toString('base64url');

/** The person's calendar token, created the first time it is needed. */
export async function getCalendarToken(db: AppDatabase, userId: string): Promise<string> {
  const [u] = await db.select({ token: users.calendarToken }).from(users).where(eq(users.id, userId));
  if (u?.token) return u.token;
  const token = newToken();
  await db.update(users).set({ calendarToken: token }).where(eq(users.id, userId));
  return token;
}

/** A new link; the old one stops working at once (e.g. after it was shared by mistake). */
export async function resetCalendarToken(db: AppDatabase, userId: string): Promise<string> {
  const token = newToken();
  await db.update(users).set({ calendarToken: token }).where(eq(users.id, userId));
  await audit(db, userId, 'calendar.reset', 'user', userId, {});
  return token;
}

const SITE_LOCATION: Record<string, string> = { oerlikon: 'oerlikon', winterthur: 'winterthur' };

/** Text for an iCalendar property: escapes \ ; , and line breaks. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded, as the format requires. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--; // never split a UTF-8 character
    parts.push((start === 0 ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n');
}

const stamp = (iso: string, min: number) => `${iso.replace(/-/g, '')}T${String(Math.floor(min / 60) % 24).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;

/** Swiss time zone (CET/CEST), so the times stay right across the summer-time change. */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Zurich',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** The feed for a token, or null if the token is unknown or the person is no longer active. */
export async function buildCalendar(db: AppDatabase, token: string, now = new Date()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const [user] = await db.select().from(users).where(eq(users.calendarToken, token));
  if (!user || !user.active) return null;

  const today = todayIso(now);
  const from = addDays(today, -35);
  const to = addDays(today, 180);
  const rows = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, user.id), gte(shifts.workDate, from), lte(shifts.workDate, to)))
    .orderBy(asc(shifts.workDate), asc(shifts.startMin));
  // Only weeks the Leitung has published (drafts can still change)
  const published = new Set((await db.select().from(rosterWeeks).where(eq(rosterWeeks.status, 'PUBLISHED'))).map((w) => `${w.site}:${w.weekStart}`));
  const visible = rows.filter((r) => published.has(`${r.site}:${mondayOf(r.workDate)}`));
  const locIds = [...new Set(visible.map((r) => SITE_LOCATION[r.site]).filter((x): x is string => Boolean(x)))];
  const locs = locIds.length ? await db.select().from(locations).where(inArray(locations.id, locIds)) : [];
  const dtstamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AsiaWay//Staff Dienstplan//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`AsiaWay Dienstplan – ${user.name}`)}`,
    'X-WR-TIMEZONE:Europe/Zurich',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
  ];
  for (const s of visible) {
    const siteName = ROSTER_SITES.find((x) => x.id === s.site)?.name ?? s.site;
    const loc = locs.find((l) => l.id === SITE_LOCATION[s.site]);
    const endDate = s.endMin > 24 * 60 ? addDays(s.workDate, 1) : s.workDate;
    const desc = [`${formatTime(s.startMin)}–${formatTime(s.endMin)}`, s.station, s.roleLabel, s.breakMin ? `Pause ${s.breakMin} Min.` : null].filter(Boolean).join(' · ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@staff.asiaway.ch`,
      `DTSTAMP:${dtstamp}`,
      `LAST-MODIFIED:${s.updatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
      `DTSTART;TZID=Europe/Zurich:${stamp(s.workDate, s.startMin)}`,
      `DTEND;TZID=Europe/Zurich:${stamp(endDate, s.endMin > 24 * 60 ? s.endMin - 24 * 60 : s.endMin)}`,
      `SUMMARY:${esc(`AsiaWay ${siteName} · ${s.roleLabel || s.station}`)}`,
      `DESCRIPTION:${esc(desc)}`,
      ...(loc ? [`LOCATION:${esc(`AsiaWay ${siteName}, ${loc.address}`)}`] : []),
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
