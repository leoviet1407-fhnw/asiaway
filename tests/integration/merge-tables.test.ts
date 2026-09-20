import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import {
  auditEvents,
  diningSessions,
  menuCategories,
  menuItems,
  restaurantTables,
  tableGroupMembers,
  tableGroups,
  users,
} from '../../src/server/db/schema';
import {
  closeSession,
  getActiveTableGroups,
  getSessionDetail,
  getTableOverview,
  mergeTables,
  resolveScan,
  unmergeTables,
} from '../../src/server/services/session-service';
import {
  confirmOrder,
  createOrderForTable,
  submitOrder,
} from '../../src/server/services/order-service';
import { generateQrToken } from '../../src/domain/session/qr-token';
import type { Db } from '../../src/server/services/order-service';

let ctx: TestContext;
let db: Db;
let waiterId: string;
let pho: string;
const tableId: Record<string, string> = {};
const tableToken: Record<string, string> = {};

beforeAll(async () => {
  ctx = await createTestDatabase();
  db = ctx.db as unknown as Db;
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.client.exec(`
    truncate audit_events, order_revisions, order_items, order_notes, notifications,
             idempotency_keys, orders, customer_devices, dining_sessions,
             table_group_members, table_groups, menu_items, menu_categories,
             restaurant_tables, auth_sessions, login_attempts, users
    restart identity cascade;
  `);

  const [waiter] = await db
    .insert(users)
    .values({ email: 'anna@asiaway.test', passwordHash: 'x', displayName: 'Anna' })
    .returning();
  waiterId = waiter!.id;

  // The real plan: 53-52-51-50 in a row, 14 beside 13, 11 beside 10,
  // with a divider between the 13/14 and 11/10 rows.
  for (const n of ['53', '52', '51', '50', '14', '13', '11', '10', '15', '12', '4']) {
    const token = generateQrToken();
    const [row] = await db
      .insert(restaurantTables)
      .values({ tableNumber: n, displayName: `Table ${n}`, qrToken: token, area: 'INSIDE' })
      .returning();
    tableId[n] = row!.id;
    tableToken[n] = token;
  }

  const [category] = await db
    .insert(menuCategories)
    .values({
      slug: 'noodle-soup',
      kind: 'FOOD',
      nameEn: 'Noodle Soups',
      nameDe: 'Nudelsuppen',
      nameVi: 'Món nước',
      sortOrder: 1,
    })
    .returning();

  const [item] = await db
    .insert(menuItems)
    .values({
      categoryId: category!.id,
      externalKey: 'ns:40:pho',
      dishNumber: '40',
      nameEn: 'Beef Noodle Soup',
      nameDe: 'x',
      nameVi: 'Phở bò',
      descriptionEn: 'd',
      descriptionDe: 'd',
      descriptionVi: 'd',
      priceCents: 2450,
      allergenCodes: ['D'],
      sortOrder: 1,
    })
    .returning();
  pho = item!.id;
});

describe('pushing tables together', () => {
  it('joins neighbouring tables, anchored on the lowest number', async () => {
    const result = await mergeTables(db, {
      tableIds: [tableId['52']!, tableId['51']!, tableId['53']!],
      userId: waiterId,
    });

    expect(result.anchorTableNumber).toBe('51');
    expect(result.memberTableNumbers).toEqual(['51', '52', '53']);
  });

  it('sends every member table’s QR to the one shared session', async () => {
    await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });

    const fromFar = await resolveScan(db, { qrToken: tableToken['53']! });
    const fromAnchor = await resolveScan(db, { qrToken: tableToken['52']! });

    expect(fromFar.sessionId).toBe(fromAnchor.sessionId);
    expect(fromFar.tableNumber).toBe('52'); // the anchor
    expect(fromFar.scannedTableNumber).toBe('53');
    expect(fromFar.isCombined).toBe(true);
  });

  it('gives the joined party one bill, whichever code they scanned', async () => {
    await mergeTables(db, { tableIds: [tableId['53']!, tableId['52']!], userId: waiterId });

    const a = await resolveScan(db, { qrToken: tableToken['53']! });
    const b = await resolveScan(db, { qrToken: tableToken['52']! });

    await submitOrder(db, {
      sessionId: a.sessionId,
      deviceId: a.deviceId,
      lines: [{ menuItemId: pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    await submitOrder(db, {
      sessionId: b.sessionId,
      deviceId: b.deviceId,
      lines: [{ menuItemId: pho, quantity: 2 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const open = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.status, 'ORDER_PENDING'));
    expect(open).toHaveLength(1);
  });

  it('records the merge in the audit trail', async () => {
    const result = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'TABLE_GROUP_CREATED'));

    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(waiterId);
    expect((events[0]!.afterValue as any).anchor).toBe('52');
    expect(result.groupId).toBe(events[0]!.entityId);
  });
});

describe('what merging refuses', () => {
  it('refuses once a table already has orders', async () => {
    const scan = await resolveScan(db, { qrToken: tableToken['53']! });
    await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    await expect(
      mergeTables(db, { tableIds: [tableId['53']!, tableId['52']!], userId: waiterId }),
    ).rejects.toThrow(/already has orders/i);
  });

  it('still allows merging a table that is seated but has not ordered', async () => {
    await resolveScan(db, { qrToken: tableToken['53']! });
    const result = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    expect(result.anchorTableNumber).toBe('52');
  });

  it('refuses tables that are not next to each other', async () => {
    await expect(
      mergeTables(db, { tableIds: [tableId['53']!, tableId['4']!], userId: waiterId }),
    ).rejects.toThrow(/not next to each other/i);
  });

  it('refuses to push a table through a divider', async () => {
    // A screen stands between the 13/14 row and the 11/10 row.
    await expect(
      mergeTables(db, { tableIds: [tableId['14']!, tableId['11']!], userId: waiterId }),
    ).rejects.toThrow(/not next to each other/i);
    // And between 15 and 12.
    await expect(
      mergeTables(db, { tableIds: [tableId['15']!, tableId['12']!], userId: waiterId }),
    ).rejects.toThrow(/not next to each other/i);
  });

  it('refuses a single table, and a table already joined elsewhere', async () => {
    await expect(
      mergeTables(db, { tableIds: [tableId['53']!], userId: waiterId }),
    ).rejects.toThrow(/at least two/i);

    await mergeTables(db, { tableIds: [tableId['53']!, tableId['52']!], userId: waiterId });
    await expect(
      mergeTables(db, { tableIds: [tableId['52']!, tableId['51']!], userId: waiterId }),
    ).rejects.toThrow(/already joined/i);
  });
});

describe('separating tables again', () => {
  it('frees the other tables and leaves the session on the anchor', async () => {
    const merged = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    const scan = await resolveScan(db, { qrToken: tableToken['53']! });

    const result = await unmergeTables(db, { groupId: merged.groupId, userId: waiterId });
    expect(result.freedTableNumbers.sort()).toEqual(['52', '53']);

    const [session] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, scan.sessionId));
    expect(session!.status).not.toBe('CLOSED');
    expect(session!.tableGroupId).toBeNull();

    // 53 now has its own session again when scanned.
    const after = await resolveScan(db, { qrToken: tableToken['53']! });
    expect(after.sessionId).not.toBe(scan.sessionId);
    expect(after.tableNumber).toBe('53');
  });

  it('lets the tables be joined again afterwards', async () => {
    const first = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    await unmergeTables(db, { groupId: first.groupId, userId: waiterId });

    const second = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    expect(second.groupId).not.toBe(first.groupId);
  });

  it('audits the separation', async () => {
    const merged = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    await unmergeTables(db, { groupId: merged.groupId, userId: waiterId });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'TABLE_GROUP_DISSOLVED'));
    expect(events).toHaveLength(1);
  });

  it('reports active groups for the dashboard, and drops them once separated', async () => {
    const merged = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!, tableId['51']!],
      userId: waiterId,
    });

    let groups = await getActiveTableGroups(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tables).toEqual(['51', '52', '53']);

    await unmergeTables(db, { groupId: merged.groupId, userId: waiterId });
    groups = await getActiveTableGroups(db);
    expect(groups).toHaveLength(0);
  });

  it('leaves no active membership rows behind', async () => {
    const merged = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    await unmergeTables(db, { groupId: merged.groupId, userId: waiterId });

    const active = await db
      .select()
      .from(tableGroupMembers)
      .where(isNull(tableGroupMembers.leftAt));
    expect(active).toHaveLength(0);

    const [group] = await db.select().from(tableGroups).where(eq(tableGroups.id, merged.groupId));
    expect(group!.status).toBe('DISSOLVED');
  });
});

describe('separating again when the bill is paid', () => {
  /** Joined tables with one confirmed order, ready to be closed. */
  async function joinedPartyReadyToPay(numbers: string[]) {
    const merged = await mergeTables(db, {
      tableIds: numbers.map((n) => tableId[n]!),
      userId: waiterId,
    });
    const scan = await resolveScan(db, { qrToken: tableToken[numbers[0]!]! });
    const order = await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: pho, quantity: 2 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    await confirmOrder(db, { orderId: order.orderId, userId: waiterId });
    return { merged, scan };
  }

  it('separates the tables automatically when the session is closed', async () => {
    const { scan } = await joinedPartyReadyToPay(['53', '52']);

    const result = await closeSession(db, { sessionId: scan.sessionId, userId: waiterId });

    expect(result.separatedTableNumbers.sort()).toEqual(['52', '53']);
    expect(await getActiveTableGroups(db)).toHaveLength(0);
  });

  it('frees every member table, not just the anchor', async () => {
    const { scan } = await joinedPartyReadyToPay(['53', '52', '51']);
    await closeSession(db, { sessionId: scan.sessionId, userId: waiterId });

    // A free table is one with no open session — that is how the dashboard
    // decides a table is available.
    const overview = await getTableOverview(db);
    for (const n of ['51', '52', '53']) {
      const table = overview.find((t) => t.tableNumber === n);
      expect(table!.sessionId, `table ${n} should be free`).toBeNull();
      expect(table!.sessionStatus, `table ${n} should have no open session`).toBeNull();
    }
    // …and none of them is still tied to the others.
    expect(await getActiveTableGroups(db)).toHaveLength(0);
  });

  it('lets the next guests at a former member table start their own bill', async () => {
    const { scan } = await joinedPartyReadyToPay(['53', '52']);
    await closeSession(db, { sessionId: scan.sessionId, userId: waiterId });

    // 53 was a member, not the anchor: the table most at risk of still
    // pointing at the old shared session.
    const next = await resolveScan(db, { qrToken: tableToken['53']! });
    expect(next.isNewSession).toBe(true);
    expect(next.sessionId).not.toBe(scan.sessionId);
    expect(next.tableNumber).toBe('53'); // its own table again, not the anchor
    expect(next.isCombined).toBe(false);

    // And 52 is now a separate party, not the same bill.
    const other = await resolveScan(db, { qrToken: tableToken['52']! });
    expect(other.sessionId).not.toBe(next.sessionId);
  });

  it('leaves no active membership rows behind', async () => {
    const { merged, scan } = await joinedPartyReadyToPay(['53', '52']);
    await closeSession(db, { sessionId: scan.sessionId, userId: waiterId });

    const active = await db
      .select()
      .from(tableGroupMembers)
      .where(isNull(tableGroupMembers.leftAt));
    expect(active).toHaveLength(0);

    const [group] = await db.select().from(tableGroups).where(eq(tableGroups.id, merged.groupId));
    expect(group!.status).toBe('DISSOLVED');
    expect(group!.dissolvedAt).not.toBeNull();
  });

  it('records the separation as automatic, attributed to the closing waiter', async () => {
    const { merged, scan } = await joinedPartyReadyToPay(['53', '52']);
    await closeSession(db, { sessionId: scan.sessionId, userId: waiterId });

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, 'TABLE_GROUP_DISSOLVED'),
          eq(auditEvents.entityId, merged.groupId),
        ),
      );
    expect(event).toBeDefined();
    expect((event!.metadata as any).auto).toBe(true);
    expect((event!.metadata as any).reason).toBe('session closed');
    expect(event!.actorUserId).toBe(waiterId);
    expect((event!.beforeValue as any).members.sort()).toEqual(['52', '53']);
    // Tied to the bill, so it shows in that session's history and not only in
    // the global log.
    expect(event!.sessionId).toBe(scan.sessionId);
  });

  it('keeps the closed session’s record of having been a joined bill', async () => {
    const { merged, scan } = await joinedPartyReadyToPay(['53', '52']);
    await closeSession(db, { sessionId: scan.sessionId, userId: waiterId });

    // The history must still explain why one bill covered two tables.
    const [session] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, scan.sessionId));
    expect(session!.tableGroupId).toBe(merged.groupId);
  });

  it('separates a forced close too', async () => {
    const merged = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    const scan = await resolveScan(db, { qrToken: tableToken['53']! });
    await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    // Left without the order ever being confirmed: the tables must still free up.
    await closeSession(db, {
      sessionId: scan.sessionId,
      userId: waiterId,
      force: true,
      reason: 'party left',
    });

    expect(await getActiveTableGroups(db)).toHaveLength(0);
    const [group] = await db.select().from(tableGroups).where(eq(tableGroups.id, merged.groupId));
    expect(group!.status).toBe('DISSOLVED');
  });

  it('closing an ordinary unjoined session touches no groups', async () => {
    // 53 + 52 belong to one party; table 11 is somebody else entirely.
    await mergeTables(db, { tableIds: [tableId['53']!, tableId['52']!], userId: waiterId });

    const other = await resolveScan(db, { qrToken: tableToken['11']! });
    await closeSession(db, { sessionId: other.sessionId, userId: waiterId });

    const groups = await getActiveTableGroups(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tables).toEqual(['52', '53']);
  });

  it('tells the waiter which tables the bill covers before they close it', async () => {
    const { scan } = await joinedPartyReadyToPay(['53', '52']);

    const detail = await getSessionDetail(db, scan.sessionId);
    expect(detail.joinedTables).toEqual(['52', '53']);

    await closeSession(db, { sessionId: scan.sessionId, userId: waiterId });

    // Once separated, the closed bill no longer claims to cover live tables.
    const after = await getSessionDetail(db, scan.sessionId);
    expect(after.joinedTables).toEqual([]);
  });

  it('an unjoined session reports no joined tables', async () => {
    const scan = await resolveScan(db, { qrToken: tableToken['11']! });
    const detail = await getSessionDetail(db, scan.sessionId);
    expect(detail.joinedTables).toEqual([]);
  });
});

describe('a waiter taking the order on the tablet', () => {
  it('puts an order tapped on a member table onto the one shared bill', async () => {
    await mergeTables(db, { tableIds: [tableId['53']!, tableId['52']!], userId: waiterId });

    // 53 is a member; 52 is the anchor. Both orders belong to one party.
    await createOrderForTable(db, {
      tableId: tableId['53']!,
      userId: waiterId,
      lines: [{ menuItemId: pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    await createOrderForTable(db, {
      tableId: tableId['52']!,
      userId: waiterId,
      lines: [{ menuItemId: pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const open = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.status, 'OCCUPIED'));
    expect(open, 'a joined party must have exactly one open bill').toHaveLength(1);

    const detail = await getSessionDetail(db, open[0]!.id);
    expect(detail.orders).toHaveLength(2);
    expect(detail.totalCents).toBe(2450 * 2);
    expect(detail.table!.tableNumber).toBe('52'); // the anchor holds the bill
  });

  it('separates the tables when that tablet-taken bill is closed', async () => {
    const merged = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });
    await createOrderForTable(db, {
      tableId: tableId['53']!,
      userId: waiterId,
      lines: [{ menuItemId: pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const [session] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.status, 'OCCUPIED'));
    expect(session!.tableGroupId).toBe(merged.groupId);

    const result = await closeSession(db, { sessionId: session!.id, userId: waiterId });
    expect(result.separatedTableNumbers.sort()).toEqual(['52', '53']);
    expect(await getActiveTableGroups(db)).toHaveLength(0);
  });

  it('takes over a session opened by a scan before the tables were joined', async () => {
    // Guests sit at 52 and scan, but have not ordered; the tables are then
    // pushed together to seat the rest of the party.
    const scan = await resolveScan(db, { qrToken: tableToken['52']! });
    const merged = await mergeTables(db, {
      tableIds: [tableId['53']!, tableId['52']!],
      userId: waiterId,
    });

    // The waiter takes the order on the tablet, tapping the member table.
    await createOrderForTable(db, {
      tableId: tableId['53']!,
      userId: waiterId,
      lines: [{ menuItemId: pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const open = await db
      .select()
      .from(diningSessions)
      .where(ne(diningSessions.status, 'CLOSED'));
    expect(open).toHaveLength(1);
    expect(open[0]!.id, 'the order joins the session the guests already opened').toBe(
      scan.sessionId,
    );
    expect(open[0]!.tableGroupId).toBe(merged.groupId);

    const detail = await getSessionDetail(db, scan.sessionId);
    expect(detail.joinedTables).toEqual(['52', '53']);

    await closeSession(db, { sessionId: scan.sessionId, userId: waiterId });
    expect(await getActiveTableGroups(db)).toHaveLength(0);
  });

  it('an unjoined table is unaffected — its own table, its own bill', async () => {
    await createOrderForTable(db, {
      tableId: tableId['11']!,
      userId: waiterId,
      lines: [{ menuItemId: pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const [session] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.status, 'OCCUPIED'));
    expect(session!.primaryTableId).toBe(tableId['11']);
    expect(session!.tableGroupId).toBeNull();
  });
});
