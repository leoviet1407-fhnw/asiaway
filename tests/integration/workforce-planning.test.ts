import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import { SERVICE_ROLES, newOpaqueToken, resolveSession, sha256 } from '../../src/server/auth/session';
import {
  clearDayAvailability,
  getAvailabilityWorkspace,
  setDayAvailability,
} from '../../src/server/services/availability-service';
import type { AppDatabase } from '../../src/server/db/client';

/**
 * The B1 schema's job is to make the September 2026 plan's defects impossible
 * to store, not merely discouraged. These are database guarantees, so they are
 * tested against a real database.
 */
let ctx: TestContext;
const exec = (text: string) => ctx.client.exec(text);
const rows = async (text: string) => (await ctx.client.query(text)).rows as any[];

beforeAll(async () => {
  ctx = await createTestDatabase();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await exec(
    'truncate employments, availability, absences, roster_periods, auth_sessions, users cascade;',
  );
});

async function makeUser(name: string, role = 'WAITER'): Promise<string> {
  const r = await rows(`
    insert into users (email, password_hash, display_name, role)
    values ('${name.toLowerCase()}@asiaway.test', 'x', '${name}', '${role}')
    returning id
  `);
  return r[0].id;
}

describe('roles', () => {
  it('accepts the planner and back-of-house roles added in 0007', async () => {
    await expect(makeUser('XUAN', 'MANAGER')).resolves.toBeTruthy();
    await expect(makeUser('KITCHEN', 'STAFF')).resolves.toBeTruthy();
  });

  it('carries the real role on the session, not a hardcoded WAITER', async () => {
    const db = ctx.db as unknown as AppDatabase;
    for (const role of ['WAITER', 'MANAGER', 'STAFF'] as const) {
      const id = await makeUser(`P${role}`, role);
      const token = newOpaqueToken();
      await exec(`insert into auth_sessions (user_id, token_hash, expires_at)
                  values ('${id}', '${sha256(token)}', now() + interval '12 hours')`);
      const user = await resolveSession(db, token);
      expect(user?.role).toBe(role);
    }
  });

  it('keeps kitchen STAFF off the waiter tablet', () => {
    // getWaiter() gates on exactly this list; STAFF are rostered but do not serve.
    expect(SERVICE_ROLES).toContain('WAITER');
    expect(SERVICE_ROLES).toContain('MANAGER');
    expect(SERVICE_ROLES).not.toContain('STAFF');
  });
});

describe('submitting availability', () => {
  const db = () => ctx.db as unknown as AppDatabase;

  async function openMonth(deadline = "now() + interval '3 days'"): Promise<string> {
    const r = await rows(`insert into roster_periods
        (starts_on, ends_on, state, availability_deadline)
      values (date '2026-10-01', date '2026-10-31', 'AVAILABILITY_OPEN', ${deadline})
      returning id`);
    return r[0].id;
  }

  async function contracted(name: string, pensum: number): Promise<string> {
    const id = await makeUser(name);
    await exec(`insert into employments (user_id, employment_type, pensum_percent, valid_from)
                values ('${id}', 'PART_TIME', ${pensum}, date '2026-01-01')`);
    return id;
  }

  it('gives a 70% contract its October corridor', async () => {
    const id = await contracted('YEN', 70);
    await openMonth();
    const ws = await getAvailabilityWorkspace(db(), id);
    expect(ws.period?.days).toBe(31);
    // 70% of 40-42.5 h/week, scaled to 31 days.
    expect(ws.corridor).toMatchObject({ minMinutes: 7440, maxMinutes: 7905 });
    expect(ws.contract?.weight).toBe('ADVISORY');
  });

  it('gives an Aushilfe no corridor, because they are owed no hours', async () => {
    const id = await makeUser('DENNIS');
    await exec(`insert into employments (user_id, employment_type, valid_from)
                values ('${id}', 'ON_CALL', date '2026-01-01')`);
    await openMonth();
    const ws = await getAvailabilityWorkspace(db(), id);
    expect(ws.corridor).toBeNull();
    expect(ws.contract?.weight).toBe('BINDING');
  });

  it('replaces a day rather than leaving two contradictory answers', async () => {
    const id = await contracted('TAMIE', 80);
    await openMonth();
    await setDayAvailability(db(), {
      userId: id, onDate: '2026-10-05', kind: 'AVAILABLE', fromTime: '10:30', toTime: '14:30',
    });
    await setDayAvailability(db(), {
      userId: id, onDate: '2026-10-05', kind: 'PREFERRED', fromTime: '17:30', toTime: '22:00',
    });
    const ws = await getAvailabilityWorkspace(db(), id);
    expect(ws.days).toHaveLength(1);
    expect(ws.days[0]).toMatchObject({ kind: 'PREFERRED', fromTime: '17:30', toTime: '22:00' });
  });

  it('stores "cannot work" as the whole day', async () => {
    const id = await contracted('PHUOC', 80);
    await openMonth();
    await setDayAvailability(db(), { userId: id, onDate: '2026-10-06', kind: 'UNAVAILABLE' });
    const ws = await getAvailabilityWorkspace(db(), id);
    expect(ws.days[0]).toMatchObject({ kind: 'UNAVAILABLE', fromTime: '00:00', toTime: '23:59' });
  });

  it('clears a day back to "I have not said"', async () => {
    const id = await contracted('MERSI', 100);
    await openMonth();
    await setDayAvailability(db(), {
      userId: id, onDate: '2026-10-07', kind: 'AVAILABLE', fromTime: '10:30', toTime: '14:30',
    });
    await clearDayAvailability(db(), id, '2026-10-07');
    expect((await getAvailabilityWorkspace(db(), id)).days).toHaveLength(0);
  });

  it('refuses a date outside the month being collected', async () => {
    const id = await contracted('APRIL', 100);
    await openMonth();
    await expect(
      setDayAvailability(db(), {
        userId: id, onDate: '2026-11-02', kind: 'AVAILABLE', fromTime: '10:30', toTime: '14:30',
      }),
    ).rejects.toThrow(/not in a month/i);
  });

  it('refuses a submission after the deadline, however the screen was rendered', async () => {
    const id = await contracted('EDMOND', 100);
    await openMonth("now() - interval '1 hour'");
    const ws = await getAvailabilityWorkspace(db(), id);
    expect(ws.period?.isOpen).toBe(false);
    await expect(
      setDayAvailability(db(), {
        userId: id, onDate: '2026-10-08', kind: 'AVAILABLE', fromTime: '10:30', toTime: '14:30',
      }),
    ).rejects.toThrow(/deadline/i);
  });

  it('reports no period at all when nothing is being collected', async () => {
    const id = await contracted('XUAN2', 100);
    const ws = await getAvailabilityWorkspace(db(), id);
    expect(ws.period).toBeNull();
    expect(ws.days).toHaveLength(0);
  });
});

describe('the house work-time policy', () => {
  it('is seeded with the restaurant’s confirmed answer', async () => {
    const [p] = await rows('select * from work_time_policy where valid_to is null');
    expect(Number(p.weekly_hours_min_at_100)).toBe(40);
    expect(Number(p.weekly_hours_max_at_100)).toBe(42.5);
    expect(p.default_shift_end).toBe('22:00:00');
  });

  it('allows only one policy in force at a time', async () => {
    await expect(
      exec(`insert into work_time_policy
              (valid_from, weekly_hours_min_at_100, weekly_hours_max_at_100, default_shift_end)
            values (date '2027-01-01', 40, 42.5, time '22:00')`),
    ).rejects.toThrow(/work_time_policy_current_idx|duplicate key/i);
  });

  it('refuses an inverted corridor', async () => {
    await expect(
      exec(`insert into work_time_policy
              (valid_from, valid_to, weekly_hours_min_at_100, weekly_hours_max_at_100, default_shift_end)
            values (date '2025-01-01', date '2026-01-01', 42.5, 40, time '22:00')`),
    ).rejects.toThrow(/band_ordered/i);
  });
});

describe('contracts', () => {
  it('stores the September team as planned', async () => {
    for (const [name, type, pensum] of [
      ['APRIL', 'FULL_TIME', '100'],
      ['TAMIE', 'PART_TIME', '80'],
      ['YEN', 'PART_TIME', '70'],
    ] as const) {
      const id = await makeUser(name);
      await exec(`insert into employments (user_id, employment_type, pensum_percent, valid_from)
                  values ('${id}', '${type}', ${pensum}, date '2026-01-01')`);
    }
    const r = await rows('select count(*)::int n from employments');
    expect(r[0].n).toBe(3);
  });

  it('refuses an Aushilfe with a pensum — they are owed no hours', async () => {
    const id = await makeUser('DENNIS');
    await expect(
      exec(`insert into employments (user_id, employment_type, pensum_percent, valid_from)
            values ('${id}', 'ON_CALL', 80, date '2026-01-01')`),
    ).rejects.toThrow(/pensum_matches_type/i);
  });

  it('refuses a contracted employee without one', async () => {
    const id = await makeUser('MERSI');
    await expect(
      exec(`insert into employments (user_id, employment_type, valid_from)
            values ('${id}', 'FULL_TIME', date '2026-01-01')`),
    ).rejects.toThrow(/pensum_matches_type/i);
  });

  it('accepts an Aushilfe with no pensum at all', async () => {
    const id = await makeUser('JENNY');
    await exec(`insert into employments (user_id, employment_type, valid_from)
                values ('${id}', 'ON_CALL', date '2026-01-01')`);
    const [e] = await rows(`select pensum_percent from employments`);
    expect(e.pensum_percent).toBeNull();
  });

  it('allows only one current contract per person, but keeps the history', async () => {
    const id = await makeUser('PHUOC');
    await exec(`insert into employments (user_id, employment_type, pensum_percent, valid_from)
                values ('${id}', 'PART_TIME', 80, date '2026-01-01')`);

    await expect(
      exec(`insert into employments (user_id, employment_type, pensum_percent, valid_from)
            values ('${id}', 'PART_TIME', 60, date '2026-06-01')`),
    ).rejects.toThrow(/employments_current_idx|duplicate key/i);

    // Closing the old row is what makes room for the new one, so last month
    // still resolves against last month's pensum.
    await exec(`update employments set valid_to = date '2026-06-01' where user_id = '${id}'`);
    await exec(`insert into employments (user_id, employment_type, pensum_percent, valid_from)
                values ('${id}', 'PART_TIME', 60, date '2026-06-01')`);
    const r = await rows(`select count(*)::int n from employments where user_id = '${id}'`);
    expect(r[0].n).toBe(2);
  });
});

describe('stations', () => {
  it('records the bar as self-serve rather than as an empty cell', async () => {
    const [bar] = await rows(`select staffing_policy from stations where code = 'BAR'`);
    expect(bar.staffing_policy).toBe('SELF_SERVE');
  });

  it('gives the cleaning duties a station of their own', async () => {
    const [c] = await rows(`select name_de from stations where code = 'CLEANING'`);
    expect(c.name_de).toMatch(/Reinigung/);
  });
});

describe('availability', () => {
  async function period(): Promise<string> {
    const r = await rows(`insert into roster_periods (starts_on, ends_on, state)
                          values (date '2026-10-01', date '2026-10-31', 'AVAILABILITY_OPEN')
                          returning id`);
    return r[0].id;
  }

  it('records a window a person can work', async () => {
    const uid = await makeUser('YEN');
    const pid = await period();
    await exec(`insert into availability (user_id, period_id, on_date, from_time, to_time, kind)
                values ('${uid}', '${pid}', date '2026-10-02', time '17:00', time '22:00', 'AVAILABLE')`);
    const [a] = await rows('select kind, from_time, to_time from availability');
    expect(a).toMatchObject({ kind: 'AVAILABLE', from_time: '17:00:00', to_time: '22:00:00' });
  });

  it('refuses a window that ends before it starts', async () => {
    const uid = await makeUser('TAMIE');
    const pid = await period();
    await expect(
      exec(`insert into availability (user_id, period_id, on_date, from_time, to_time, kind)
            values ('${uid}', '${pid}', date '2026-10-02', time '22:00', time '17:00', 'AVAILABLE')`),
    ).rejects.toThrow(/availability_window/i);
  });

  it('refuses two submissions for the same person, date and start', async () => {
    const uid = await makeUser('EDMOND');
    const pid = await period();
    const ins = `insert into availability (user_id, period_id, on_date, from_time, to_time, kind)
                 values ('${uid}', '${pid}', date '2026-10-02', time '10:30', time '14:30', 'AVAILABLE')`;
    await exec(ins);
    await expect(exec(ins)).rejects.toThrow(/availability_slot_idx|duplicate key/i);
  });
});

describe('absence', () => {
  it('distinguishes PATRICIA on holiday from PATRICIA overlooked', async () => {
    const uid = await makeUser('PATRICIA');
    await exec(`insert into absences (user_id, starts_on, ends_on, absence_type, state, decided_at)
                values ('${uid}', date '2026-09-07', date '2026-09-13', 'VACATION', 'APPROVED', now())`);
    const [a] = await rows('select absence_type, state from absences');
    expect(a).toMatchObject({ absence_type: 'VACATION', state: 'APPROVED' });
  });

  it('refuses a decided absence with no record of the decision', async () => {
    const uid = await makeUser('JENNY');
    await expect(
      exec(`insert into absences (user_id, starts_on, ends_on, absence_type, state)
            values ('${uid}', date '2026-09-07', date '2026-09-13', 'SICK', 'APPROVED')`),
    ).rejects.toThrow(/absences_decision/i);
  });

  it('refuses a range that ends before it starts', async () => {
    const uid = await makeUser('MERSI');
    await expect(
      exec(`insert into absences (user_id, starts_on, ends_on, absence_type)
            values ('${uid}', date '2026-09-13', date '2026-09-07', 'UNPAID')`),
    ).rejects.toThrow(/absences_period/i);
  });
});
