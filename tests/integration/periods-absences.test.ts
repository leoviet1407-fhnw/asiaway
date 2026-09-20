import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import {
  createMonth,
  decideAbsence,
  listAbsencesFor,
  listPendingAbsences,
  listPeriods,
  requestAbsence,
  setPeriodState,
} from '../../src/server/services/period-service';
import type { AppDatabase } from '../../src/server/db/client';

let ctx: TestContext;
const exec = (t: string) => ctx.client.exec(t);
const rows = async (t: string) => (await ctx.client.query(t)).rows as any[];
const db = () => ctx.db as unknown as AppDatabase;

beforeAll(async () => {
  ctx = await createTestDatabase();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await exec('truncate shifts, absences, roster_periods, audit_events, users cascade;');
});

async function user(name: string, role = 'WAITER'): Promise<string> {
  const r = await rows(`insert into users (email, password_hash, display_name, role)
    values ('${name.toLowerCase()}@asiaway.test','x','${name}','${role}') returning id`);
  return r[0].id;
}

describe('creating a month', () => {
  it('derives the last day, so a month is always a whole month', async () => {
    const xuan = await user('XUAN', 'MANAGER');
    await createMonth(db(), '2026-10-01', null, xuan);
    const [period] = await listPeriods(db());
    expect(period).toMatchObject({ startsOn: '2026-10-01', endsOn: '2026-10-31', state: 'DRAFT' });

    await createMonth(db(), '2027-02-01', null, xuan);
    const feb = (await listPeriods(db())).find((p) => p.startsOn === '2027-02-01');
    expect(feb!.endsOn).toBe('2027-02-28');
  });

  it('refuses a start that is not the first', async () => {
    const xuan = await user('XUAN', 'MANAGER');
    await expect(createMonth(db(), '2026-10-15', null, xuan)).rejects.toThrow(/first of the month/i);
  });

  it('refuses a month that overlaps one already there', async () => {
    const xuan = await user('XUAN', 'MANAGER');
    await createMonth(db(), '2026-10-01', null, xuan);
    await expect(createMonth(db(), '2026-10-01', null, xuan)).rejects.toThrow(/overlaps/i);
  });

  it('records who created it', async () => {
    const xuan = await user('XUAN', 'MANAGER');
    await createMonth(db(), '2026-10-01', null, xuan);
    const audit = await rows(`select action, actor_user_id from audit_events`);
    expect(audit[0]).toMatchObject({ action: 'ROSTER_PERIOD_CREATED', actor_user_id: xuan });
  });
});

describe('the shift count beside each month', () => {
  it('counts the shifts actually planned', async () => {
    const xuan = await user('XUAN', 'MANAGER');
    await createMonth(db(), '2026-10-01', null, xuan);
    const [p] = await listPeriods(db());
    expect(p!.shiftCount).toBe(0);

    const [station] = await rows(`select id from stations where code = 'EG_ALACARTE'`);
    for (const day of ['01', '02', '03']) {
      await exec(`insert into shifts (period_id, on_date, station_id, starts_at, ends_at)
        values ('${p!.id}', date '2026-10-${day}', '${station.id}',
                timestamptz '2026-10-${day} 17:30+02', timestamptz '2026-10-${day} 22:00+02')`);
    }
    // A zero here would read as "nothing planned yet" rather than as a bug,
    // which is exactly how the first version of this query failed.
    expect((await listPeriods(db()))[0]!.shiftCount).toBe(3);
  });
});

describe('moving a month along', () => {
  it('goes draft → collecting → planning → published → locked', async () => {
    const xuan = await user('XUAN', 'MANAGER');
    await createMonth(db(), '2026-10-01', null, xuan);
    const [p] = await listPeriods(db());

    for (const state of ['AVAILABILITY_OPEN', 'PLANNING', 'PUBLISHED', 'LOCKED'] as const) {
      await setPeriodState(db(), p!.id, state, xuan);
    }
    const [after] = await listPeriods(db());
    expect(after!.state).toBe('LOCKED');
  });

  it('refuses to go backwards from published to collecting', async () => {
    const xuan = await user('XUAN', 'MANAGER');
    await createMonth(db(), '2026-10-01', null, xuan);
    const [p] = await listPeriods(db());
    await setPeriodState(db(), p!.id, 'PLANNING', xuan);
    await setPeriodState(db(), p!.id, 'PUBLISHED', xuan);

    await expect(setPeriodState(db(), p!.id, 'AVAILABILITY_OPEN', xuan)).rejects.toThrow(/cannot move/i);
  });

  it('lets a published month reopen for planning, but never a locked one', async () => {
    const xuan = await user('XUAN', 'MANAGER');
    await createMonth(db(), '2026-10-01', null, xuan);
    const [p] = await listPeriods(db());
    await setPeriodState(db(), p!.id, 'PLANNING', xuan);
    await setPeriodState(db(), p!.id, 'PUBLISHED', xuan);
    await setPeriodState(db(), p!.id, 'PLANNING', xuan);
    await setPeriodState(db(), p!.id, 'PUBLISHED', xuan);
    await setPeriodState(db(), p!.id, 'LOCKED', xuan);

    await expect(setPeriodState(db(), p!.id, 'PLANNING', xuan)).rejects.toThrow(/cannot move/i);
  });
});

describe('time off', () => {
  it('records a request as waiting, not granted', async () => {
    const patricia = await user('PATRICIA');
    await requestAbsence(db(), {
      userId: patricia,
      startsOn: '2026-09-07',
      endsOn: '2026-09-13',
      absenceType: 'VACATION',
    });
    const mine = await listAbsencesFor(db(), patricia);
    expect(mine[0]).toMatchObject({ state: 'REQUESTED', decidedAt: null });
  });

  it('refuses a range that ends before it starts', async () => {
    const patricia = await user('PATRICIA');
    await expect(
      requestAbsence(db(), {
        userId: patricia,
        startsOn: '2026-09-13',
        endsOn: '2026-09-07',
        absenceType: 'VACATION',
      }),
    ).rejects.toThrow(/cannot come before/i);
  });

  it('refuses a second request over the same days', async () => {
    const patricia = await user('PATRICIA');
    const base = { userId: patricia, absenceType: 'VACATION' as const };
    await requestAbsence(db(), { ...base, startsOn: '2026-09-07', endsOn: '2026-09-13' });
    await expect(
      requestAbsence(db(), { ...base, startsOn: '2026-09-10', endsOn: '2026-09-16' }),
    ).rejects.toThrow(/overlaps/i);
  });

  it('lets a manager approve, which is what blocks the roster', async () => {
    const patricia = await user('PATRICIA');
    const xuan = await user('XUAN', 'MANAGER');
    const id = await requestAbsence(db(), {
      userId: patricia,
      startsOn: '2026-09-07',
      endsOn: '2026-09-13',
      absenceType: 'VACATION',
    });

    expect(await listPendingAbsences(db())).toHaveLength(1);
    await decideAbsence(db(), id, 'APPROVED', xuan);
    expect(await listPendingAbsences(db())).toHaveLength(0);

    const [after] = await listAbsencesFor(db(), patricia);
    expect(after!.state).toBe('APPROVED');
    expect(after!.decidedBy).toBe(xuan);
    expect(after!.decidedAt).not.toBeNull();
  });

  it('refuses to decide the same request twice', async () => {
    const patricia = await user('PATRICIA');
    const xuan = await user('XUAN', 'MANAGER');
    const id = await requestAbsence(db(), {
      userId: patricia,
      startsOn: '2026-09-07',
      endsOn: '2026-09-13',
      absenceType: 'SICK',
    });
    await decideAbsence(db(), id, 'APPROVED', xuan);
    await expect(decideAbsence(db(), id, 'REJECTED', xuan)).rejects.toThrow(/already been decided/i);
  });

  it('allows a new request once an overlapping one was declined', async () => {
    const patricia = await user('PATRICIA');
    const xuan = await user('XUAN', 'MANAGER');
    const base = { userId: patricia, absenceType: 'VACATION' as const };
    const id = await requestAbsence(db(), { ...base, startsOn: '2026-09-07', endsOn: '2026-09-13' });
    await decideAbsence(db(), id, 'REJECTED', xuan);

    await expect(
      requestAbsence(db(), { ...base, startsOn: '2026-09-10', endsOn: '2026-09-16' }),
    ).resolves.toBeTruthy();
  });
});
