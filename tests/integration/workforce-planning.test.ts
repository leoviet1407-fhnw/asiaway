import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';

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
  await exec('truncate employments, availability, absences, roster_periods, users cascade;');
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
