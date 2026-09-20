import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
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
  getActiveTableGroups,
  mergeTables,
  resolveScan,
  unmergeTables,
} from '../../src/server/services/session-service';
import { submitOrder } from '../../src/server/services/order-service';
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
