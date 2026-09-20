import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import {
  acknowledgeShift,
  assignShift,
  generatePeriod,
  getMySchedule,
  publishPeriod,
  validatePeriod,
} from '../../src/server/services/roster-service';
import { rosterPeriods, shiftTemplates, shifts, stations } from '../../src/server/db/schema';
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
  await exec(
    'truncate shifts, shift_templates, employments, availability, absences, roster_periods, users cascade;',
  );
});

async function user(name: string): Promise<string> {
  const r = await rows(`insert into users (email, password_hash, display_name, role)
    values ('${name.toLowerCase()}@asiaway.test','x','${name}','WAITER') returning id`);
  return r[0].id;
}

async function contract(name: string, type: string, pensum: number | null): Promise<string> {
  const id = await user(name);
  await exec(`insert into employments (user_id, employment_type, pensum_percent, valid_from)
    values ('${id}','${type}',${pensum ?? 'NULL'},date '2026-01-01')`);
  return id;
}

async function period(state = 'PLANNING'): Promise<string> {
  const r = await rows(`insert into roster_periods (starts_on, ends_on, state)
    values (date '2026-10-01', date '2026-10-07','${state}') returning id`);
  return r[0].id;
}

async function stationId(code: string): Promise<string> {
  const [s] = await db().select({ id: stations.id }).from(stations).where(eq(stations.code, code));
  return s!.id;
}

/** One band, every weekday, so a 7-day period yields 7 shifts. */
async function template(code: string, from: string, to: string, headcount = 1): Promise<void> {
  const id = await stationId(code);
  await db()
    .insert(shiftTemplates)
    .values(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        stationId: id,
        weekday,
        startsAt: from,
        endsAt: to,
        headcount,
        effectiveFrom: '2026-01-01',
      })),
    );
}

describe('generating a month from the weekly skeleton', () => {
  it('creates one row per headcount per day', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00', 2);
    const result = await generatePeriod(db(), p);
    expect(result.created).toBe(14); // 7 days x 2 people
    const all = await db().select().from(shifts).where(eq(shifts.periodId, p));
    expect(all).toHaveLength(14);
    expect(all.every((s) => s.userId === null && s.state === 'DRAFT')).toBe(true);
  });

  it('stores a real end time, because "END" is not expressible', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const [first] = await db().select().from(shifts).where(eq(shifts.periodId, p));
    expect(first!.endsAt.getTime()).toBeGreaterThan(first!.startsAt.getTime());
    // October in Zurich is CEST until the 25th: 22:00 local is 20:00Z.
    expect(first!.endsAt.toISOString()).toBe('2026-10-01T20:00:00.000Z');
  });

  it('keeps the manager’s edits when run again', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const yen = await contract('YEN', 'PART_TIME', 70);
    const [one] = await db().select().from(shifts).where(eq(shifts.periodId, p));
    await assignShift(db(), one!.id, yen);

    const again = await generatePeriod(db(), p);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(7);
    const [still] = await db().select().from(shifts).where(eq(shifts.id, one!.id));
    expect(still!.userId).toBe(yen);
  });

  it('refuses to regenerate a published month', async () => {
    const p = await period('PUBLISHED');
    await expect(generatePeriod(db(), p)).rejects.toThrow(/published month/i);
  });
});

describe('a band that is self-serve even though its station is staffed', () => {
  it('is not counted as understaffed', async () => {
    // The food pass: "Kellner selbst" at lunch, a foodrunner at dinner. The
    // September plan could only say this in prose.
    const p = await period();
    const id = await stationId('FOODPASS');
    await db()
      .insert(shiftTemplates)
      .values([
        {
          stationId: id, weekday: 4, startsAt: '11:30', endsAt: '14:00',
          headcount: 1, staffingPolicy: 'SELF_SERVE' as const, effectiveFrom: '2026-01-01',
        },
        {
          stationId: id, weekday: 4, startsAt: '18:00', endsAt: '22:00',
          headcount: 1, effectiveFrom: '2026-01-01',
        },
      ]);
    await generatePeriod(db(), p);

    const v = await validatePeriod(db(), p);
    const understaffed = v.filter((x) => x.code === 'R7_UNDERSTAFFED');
    // 2026-10-01 is the only Thursday in the period; only the dinner band counts.
    expect(understaffed).toHaveLength(1);
    expect(understaffed[0]!.message).toContain('18:00');
  });
});

describe('validating before publishing', () => {
  it('warns that a staffed station has nobody on it', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const v = await validatePeriod(db(), p);
    expect(v.filter((x) => x.code === 'R7_UNDERSTAFFED')).toHaveLength(7);
    expect(v.every((x) => x.severity === 'WARN')).toBe(true);
  });

  it('blocks an Aushilfe rostered outside the hours they offered', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const dennis = await contract('DENNIS', 'ON_CALL', null);
    const all = await db().select().from(shifts).where(eq(shifts.periodId, p));
    await assignShift(db(), all[0]!.id, dennis);

    const v = await validatePeriod(db(), p);
    const hit = v.find((x) => x.code === 'R8A_ON_CALL_OUTSIDE');
    expect(hit?.severity).toBe('BLOCK');
    expect(hit?.message).toMatch(/offered no hours/);
  });

  it('accepts the same shift once the offer covers it', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const dennis = await contract('DENNIS', 'ON_CALL', null);
    const all = await db().select().from(shifts).where(eq(shifts.periodId, p));
    await assignShift(db(), all[0]!.id, dennis);
    await exec(`insert into availability (user_id, period_id, on_date, from_time, to_time, kind)
      values ('${dennis}','${p}',date '2026-10-01',time '17:00',time '22:00','AVAILABLE')`);

    const v = await validatePeriod(db(), p);
    expect(v.map((x) => x.code)).not.toContain('R8A_ON_CALL_OUTSIDE');
  });

  it('blocks a shift during approved leave', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const tamie = await contract('TAMIE', 'PART_TIME', 80);
    const all = await db().select().from(shifts).where(eq(shifts.periodId, p));
    await assignShift(db(), all[0]!.id, tamie);
    await exec(`insert into absences (user_id, starts_on, ends_on, absence_type, state, decided_at)
      values ('${tamie}',date '2026-10-01',date '2026-10-03','VACATION','APPROVED',now())`);

    const hit = (await validatePeriod(db(), p)).find((x) => x.code === 'R8C_ON_ABSENCE');
    expect(hit?.severity).toBe('BLOCK');
  });
});

describe('publishing', () => {
  async function readyMonth(): Promise<{ p: string; yen: string; ids: string[] }> {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const yen = await contract('YEN', 'PART_TIME', 70);
    const all = await db().select().from(shifts).where(eq(shifts.periodId, p));
    return { p, yen, ids: all.map((s) => s.id) };
  }

  it('is refused while a BLOCK stands, and changes nothing', async () => {
    const { p, ids } = await readyMonth();
    const dennis = await contract('DENNIS', 'ON_CALL', null);
    await assignShift(db(), ids[0]!, dennis);

    const result = await publishPeriod(db(), p, dennis);
    expect(result.published).toBe(false);
    expect(result.violations.some((v) => v.severity === 'BLOCK')).toBe(true);

    const [after] = await db().select().from(rosterPeriods).where(eq(rosterPeriods.id, p));
    expect(after!.state).toBe('PLANNING');
    const drafts = await db()
      .select()
      .from(shifts)
      .where(and(eq(shifts.periodId, p), eq(shifts.state, 'DRAFT')));
    expect(drafts).toHaveLength(7);
  });

  it('goes through on warnings alone', async () => {
    const { p, yen, ids } = await readyMonth();
    // Four of seven assigned: the rest stay open, which only warns.
    for (const id of ids.slice(0, 4)) await assignShift(db(), id, yen);

    const result = await publishPeriod(db(), p, yen);
    expect(result.published).toBe(true);
    expect(result.violations.some((v) => v.severity === 'BLOCK')).toBe(false);

    const [after] = await db().select().from(rosterPeriods).where(eq(rosterPeriods.id, p));
    expect(after!.state).toBe('PUBLISHED');
    expect(after!.publishedAt).not.toBeNull();
  });

  it('reaches the person view from the same single table', async () => {
    const { p, yen, ids } = await readyMonth();
    for (const id of ids.slice(0, 3)) await assignShift(db(), id, yen);
    await publishPeriod(db(), p, yen);

    const mine = await getMySchedule(db(), yen, '2026-10-01');
    expect(mine).toHaveLength(3);
    expect(mine[0]!.stationName).toMatch(/EG/);
    expect(mine.every((s) => !s.acknowledged)).toBe(true);
  });
});

describe('acknowledging', () => {
  it('lets the assignee confirm, and nobody else', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const yen = await contract('YEN', 'PART_TIME', 70);
    const mersi = await contract('MERSI', 'FULL_TIME', 100);
    const all = await db().select().from(shifts).where(eq(shifts.periodId, p));
    await assignShift(db(), all[0]!.id, yen);
    await publishPeriod(db(), p, yen);

    await expect(acknowledgeShift(db(), all[0]!.id, mersi)).rejects.toThrow(/not a published shift of yours/i);
    await acknowledgeShift(db(), all[0]!.id, yen);
    expect((await getMySchedule(db(), yen, '2026-10-01'))[0]!.acknowledged).toBe(true);
  });

  it('withdraws the confirmation when the shift changes hands', async () => {
    const p = await period();
    await template('EG_ALACARTE', '17:30', '22:00');
    await generatePeriod(db(), p);
    const yen = await contract('YEN', 'PART_TIME', 70);
    const mersi = await contract('MERSI', 'FULL_TIME', 100);
    const all = await db().select().from(shifts).where(eq(shifts.periodId, p));
    await assignShift(db(), all[0]!.id, yen);
    await publishPeriod(db(), p, yen);
    await acknowledgeShift(db(), all[0]!.id, yen);

    await assignShift(db(), all[0]!.id, mersi);
    const [after] = await db().select().from(shifts).where(eq(shifts.id, all[0]!.id));
    expect(after!.acknowledgedAt).toBeNull();
    expect(after!.revision).toBe(3);
  });
});
