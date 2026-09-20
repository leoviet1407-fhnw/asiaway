import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import {
  approveEntry,
  clockIn,
  clockOut,
  closeMonth,
  correctEntry,
  disputeEntry,
  getMonthlyStatement,
  getTimesheet,
  listPendingEntries,
  listRevisions,
  recordEntry,
} from '../../src/server/services/timesheet-service';
import { monthlyStatements, rosterPeriods, stations, timeEntries } from '../../src/server/db/schema';
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
    'truncate monthly_statements, time_entry_revisions, time_entries, shifts, absences, roster_periods, employments, users cascade;',
  );
});

async function person(name: string, type = 'PART_TIME', pensum: number | null = 80): Promise<string> {
  const r = await rows(`insert into users (email, password_hash, display_name, role)
    values ('${name.toLowerCase()}@asiaway.test','x','${name}','WAITER') returning id`);
  const id = r[0].id;
  await exec(`insert into employments (user_id, employment_type, pensum_percent, valid_from)
    values ('${id}','${type}',${pensum ?? 'NULL'},date '2026-01-01')`);
  return id;
}

async function october(): Promise<string> {
  const r = await rows(`insert into roster_periods (starts_on, ends_on, state)
    values (date '2026-10-01', date '2026-10-31','PUBLISHED') returning id`);
  return r[0].id;
}

/** A published shift, 10:30–14:30 Zurich (08:30–12:30 UTC in October). */
async function shift(periodId: string, userId: string, day: string): Promise<string> {
  const [s] = await db().select({ id: stations.id }).from(stations).where(eq(stations.code, 'EG_ALACARTE'));
  const r = await rows(`insert into shifts (period_id, on_date, station_id, user_id, starts_at, ends_at, state)
    values ('${periodId}', date '2026-10-${day}', '${s!.id}', '${userId}',
            timestamptz '2026-10-${day} 08:30+00', timestamptz '2026-10-${day} 12:30+00', 'PUBLISHED')
    returning id`);
  return r[0].id;
}

describe('clocking in and out', () => {
  it('records the hours and attaches them to the planned shift', async () => {
    const yen = await person('YEN', 'PART_TIME', 70);
    const p = await october();
    const s = await shift(p, yen, '02');

    await clockIn(db(), yen, new Date('2026-10-02T08:32:00Z'));
    await clockOut(db(), yen, 30, new Date('2026-10-02T12:40:00Z'));

    const sheet = await getTimesheet(db(), yen, '2026-10-01', '2026-10-31');
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]).toMatchObject({ state: 'SUBMITTED', source: 'CLOCK', workedMinutes: 218 });
    expect(sheet.plannedMinutes).toBe(240);
    expect(sheet.varianceMinutes).toBe(-22);

    const [entry] = await db().select().from(timeEntries);
    expect(entry!.shiftId).toBe(s);
  });

  it('refuses a second clock-in while one is running', async () => {
    const yen = await person('YEN');
    await clockIn(db(), yen, new Date('2026-10-02T08:30:00Z'));
    await expect(clockIn(db(), yen, new Date('2026-10-02T09:00:00Z'))).rejects.toThrow(
      /already clocked in/i,
    );
  });

  it('refuses a clock-out from someone who never clocked in', async () => {
    const yen = await person('YEN');
    await expect(clockOut(db(), yen, 0)).rejects.toThrow(/not clocked in/i);
  });

  it('counts a running entry as nothing worked yet', async () => {
    const yen = await person('YEN');
    await clockIn(db(), yen, new Date('2026-10-02T08:30:00Z'));
    const sheet = await getTimesheet(db(), yen, '2026-10-01', '2026-10-31');
    expect(sheet.workedMinutes).toBe(0);
    expect(sheet.openEntryId).not.toBeNull();
  });

  it('records work nobody planned', async () => {
    const dennis = await person('DENNIS', 'ON_CALL', null);
    await clockIn(db(), dennis, new Date('2026-10-02T16:00:00Z'));
    await clockOut(db(), dennis, 0, new Date('2026-10-02T20:00:00Z'));

    const pending = await listPendingEntries(db());
    expect(pending[0]).toMatchObject({ unplanned: true, workedMinutes: 240 });
  });
});

describe('a manager recording a forgotten shift', () => {
  it('writes the entry and its first revision together', async () => {
    const tamie = await person('TAMIE');
    const xuan = await person('XUAN', 'FULL_TIME', 100);
    const id = await recordEntry(
      db(),
      {
        userId: tamie,
        businessDate: '2026-10-03',
        clockInAt: new Date('2026-10-03T08:30:00Z'),
        clockOutAt: new Date('2026-10-03T12:30:00Z'),
        breakMinutes: 0,
      },
      xuan,
    );
    const revisions = await listRevisions(db(), id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ revisionNumber: 1, actorUserId: xuan });
  });

  it('refuses a window longer than sixteen hours', async () => {
    const tamie = await person('TAMIE');
    const xuan = await person('XUAN', 'FULL_TIME', 100);
    await expect(
      recordEntry(
        db(),
        {
          userId: tamie,
          businessDate: '2026-10-03',
          clockInAt: new Date('2026-10-03T06:00:00Z'),
          clockOutAt: new Date('2026-10-04T00:00:00Z'),
          breakMinutes: 0,
        },
        xuan,
      ),
    ).rejects.toThrow(/16 hours/i);
  });
});

describe('corrections', () => {
  async function submitted(): Promise<{ id: string; yen: string; xuan: string }> {
    const yen = await person('YEN', 'PART_TIME', 70);
    const xuan = await person('XUAN', 'FULL_TIME', 100);
    await clockIn(db(), yen, new Date('2026-10-02T08:30:00Z'));
    await clockOut(db(), yen, 0, new Date('2026-10-02T12:30:00Z'));
    const [entry] = await db().select().from(timeEntries);
    return { id: entry!.id, yen, xuan };
  }

  it('keeps what the entry said before, and who changed it', async () => {
    const { id, xuan } = await submitted();
    await correctEntry(
      db(),
      id,
      { clockOutAt: new Date('2026-10-02T13:30:00Z') },
      xuan,
      'Stayed to close the terrace',
    );

    const revisions = await listRevisions(db(), id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.reason).toBe('Stayed to close the terrace');
    expect((revisions[0]!.beforeSnapshot as any).clockOutAt).toBe('2026-10-02T12:30:00.000Z');
    expect((revisions[0]!.afterSnapshot as any).clockOutAt).toBe('2026-10-02T13:30:00.000Z');
  });

  it('demands a reason', async () => {
    const { id, xuan } = await submitted();
    await expect(correctEntry(db(), id, { breakMinutes: 30 }, xuan, '   ')).rejects.toThrow(
      /needs a reason/i,
    );
  });

  it('sends an approved entry back for approval', async () => {
    const { id, xuan } = await submitted();
    await approveEntry(db(), id, xuan);
    await correctEntry(db(), id, { breakMinutes: 30 }, xuan, 'Break was taken');

    const [after] = await db().select().from(timeEntries).where(eq(timeEntries.id, id));
    expect(after!.state).toBe('SUBMITTED');
    expect(after!.approvedAt).toBeNull();
  });

  it('cannot be rewritten afterwards — history is append-only', async () => {
    const { id, xuan } = await submitted();
    await correctEntry(db(), id, { breakMinutes: 30 }, xuan, 'Break was taken');
    await expect(exec(`update time_entry_revisions set reason = 'nothing to see'`)).rejects.toThrow(
      /append-only/i,
    );
    await expect(exec('delete from time_entry_revisions')).rejects.toThrow(/append-only/i);
  });

  it('refuses to correct an entry that is still running', async () => {
    const yen = await person('YEN');
    const xuan = await person('XUAN', 'FULL_TIME', 100);
    await clockIn(db(), yen, new Date('2026-10-02T08:30:00Z'));
    const [entry] = await db().select().from(timeEntries);
    await expect(correctEntry(db(), entry!.id, { breakMinutes: 5 }, xuan, 'x')).rejects.toThrow(
      /clock out before/i,
    );
  });
});

describe('disputes', () => {
  it('lets the employee object, and nobody else', async () => {
    const yen = await person('YEN');
    const mersi = await person('MERSI', 'FULL_TIME', 100);
    await clockIn(db(), yen, new Date('2026-10-02T08:30:00Z'));
    await clockOut(db(), yen, 0, new Date('2026-10-02T12:30:00Z'));
    const [entry] = await db().select().from(timeEntries);

    await expect(disputeEntry(db(), entry!.id, mersi, 'not mine')).rejects.toThrow(/not your/i);
    await disputeEntry(db(), entry!.id, yen, 'I stayed until 23:00');

    const [after] = await db().select().from(timeEntries).where(eq(timeEntries.id, entry!.id));
    expect(after!.state).toBe('DISPUTED');
    expect(await listRevisions(db(), entry!.id)).toHaveLength(1);
  });
});

describe('the monthly statement', () => {
  it('puts planned, worked and the corridor side by side', async () => {
    const yen = await person('YEN', 'PART_TIME', 70);
    const p = await october();
    await shift(p, yen, '02');
    await clockIn(db(), yen, new Date('2026-10-02T08:30:00Z'));
    await clockOut(db(), yen, 0, new Date('2026-10-02T12:30:00Z'));

    const { lines } = await getMonthlyStatement(db(), p);
    const line = lines.find((l) => l.userId === yen)!;
    expect(line).toMatchObject({ plannedMinutes: 240, workedMinutes: 240, unapproved: 1 });
    // 70% of 40–42.5 h/week over 31 days.
    expect(line.targetMinMinutes).toBe(7440);
    expect(line.targetMaxMinutes).toBe(7905);
  });

  it('gives an Aushilfe no target at all', async () => {
    const dennis = await person('DENNIS', 'ON_CALL', null);
    const p = await october();
    const { lines } = await getMonthlyStatement(db(), p);
    const line = lines.find((l) => l.userId === dennis)!;
    expect(line.targetMinMinutes).toBeNull();
    expect(line.targetMaxMinutes).toBeNull();
  });

  it('counts approved leave in days', async () => {
    const patricia = await person('PATRICIA', 'ON_CALL', null);
    const p = await october();
    await exec(`insert into absences (user_id, starts_on, ends_on, absence_type, state, decided_at)
      values ('${patricia}', date '2026-10-05', date '2026-10-09', 'VACATION', 'APPROVED', now())`);
    const { lines } = await getMonthlyStatement(db(), p);
    expect(lines.find((l) => l.userId === patricia)!.absenceDays).toBe(5);
  });

  it('carries no balance and no money, by design', async () => {
    const yen = await person('YEN', 'PART_TIME', 70);
    const p = await october();
    const { lines } = await getMonthlyStatement(db(), p);
    const keys = Object.keys(lines.find((l) => l.userId === yen)!);
    expect(keys).not.toContain('balanceMinutes');
    expect(keys.some((k) => /rate|wage|pay|salary|balance/i.test(k))).toBe(false);
  });
});

describe('closing the month', () => {
  it('is refused while anything is unapproved', async () => {
    const yen = await person('YEN', 'PART_TIME', 70);
    const xuan = await person('XUAN', 'FULL_TIME', 100);
    const p = await october();
    await shift(p, yen, '02');
    await clockIn(db(), yen, new Date('2026-10-02T08:30:00Z'));
    await clockOut(db(), yen, 0, new Date('2026-10-02T12:30:00Z'));

    await expect(closeMonth(db(), p, xuan)).rejects.toThrow(/still unapproved/i);
  });

  it('freezes the hours and locks the period', async () => {
    const yen = await person('YEN', 'PART_TIME', 70);
    const xuan = await person('XUAN', 'FULL_TIME', 100);
    const p = await october();
    await shift(p, yen, '02');
    await clockIn(db(), yen, new Date('2026-10-02T08:30:00Z'));
    await clockOut(db(), yen, 0, new Date('2026-10-02T12:30:00Z'));
    const [entry] = await db().select().from(timeEntries);
    await approveEntry(db(), entry!.id, xuan);

    await closeMonth(db(), p, xuan);

    const statements = await db().select().from(monthlyStatements);
    const line = statements.find((s) => s.userId === yen)!;
    expect(line).toMatchObject({ plannedMinutes: 240, workedMinutes: 240 });
    const [period] = await db().select().from(rosterPeriods).where(eq(rosterPeriods.id, p));
    expect(period!.state).toBe('LOCKED');
  });

  it('refuses to close twice', async () => {
    const xuan = await person('XUAN', 'FULL_TIME', 100);
    const p = await october();
    await closeMonth(db(), p, xuan);
    await expect(closeMonth(db(), p, xuan)).rejects.toThrow(/already closed/i);
  });
});
