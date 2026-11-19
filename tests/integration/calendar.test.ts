import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/domain/roles';
import { addDays, firstPlannableWeek } from '@/domain/roster';
import type { AppDatabase } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { buildCalendar, getCalendarToken, resetCalendarToken } from '@/server/services/calendar-service';
import { publishWeek, saveProfile, saveShift } from '@/server/services/roster-service';
import { todayIso } from '@/lib/dates';
import { createTestDatabase } from '../helpers/db';

describe('calendar feed', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let planner: Principal;
  let staff: Principal;
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    staff = await principal('winti-vn@asiaway.test');
    await saveProfile(db, planner, staff.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
  }, 60_000);
  afterAll(async () => close());

  it('lists published shifts only, in Swiss time, behind a private token', async () => {
    const week = firstPlannableWeek(todayIso());
    const nextWeek = addDays(week, 7);
    await saveShift(db, planner, { site: 'winterthur', date: addDays(week, 1), userId: staff.userId, startMin: 17 * 60 + 30, endMin: 22 * 60, breakMin: 0, station: 'EG Thai', roleLabel: 'Abend' });
    await saveShift(db, planner, { site: 'winterthur', date: addDays(nextWeek, 1), userId: staff.userId, startMin: 10 * 60 + 30, endMin: 14 * 60 + 30, breakMin: 0, station: 'EG Thai', roleLabel: null });
    await publishWeek(db, planner, 'winterthur', week); // the next week stays a draft

    const token = await getCalendarToken(db, staff.userId);
    expect(await getCalendarToken(db, staff.userId)).toBe(token); // stable
    const ics = (await buildCalendar(db, token))!;
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('TZID:Europe/Zurich');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain(`DTSTART;TZID=Europe/Zurich:${addDays(week, 1).replace(/-/g, '')}T173000`);
    expect(ics).toContain('SUMMARY:AsiaWay Winterthur · Abend');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);

    expect(await buildCalendar(db, 'not-a-real-token-xxxxxxxxxxxx')).toBeNull();
    const fresh = await resetCalendarToken(db, staff.userId);
    expect(await buildCalendar(db, token)).toBeNull(); // the old link stops working
    expect(await buildCalendar(db, fresh)).not.toBeNull();
  });
});
