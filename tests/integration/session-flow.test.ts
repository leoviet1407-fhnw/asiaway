import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import {
  auditEvents,
  diningSessions,
  menuCategories,
  menuItems,
  notifications,
  orders,
  restaurantTables,
  tableGroupMembers,
  tableGroups,
  users,
} from '../../src/server/db/schema';
import {
  closeIdleSessions,
  closeSession,
  getTableOverview,
  openSessionForTable,
  requestCheckout,
  resolveScan,
} from '../../src/server/services/session-service';
import { setAvailability } from '../../src/server/services/menu-service';
import { submitOrder, confirmOrder } from '../../src/server/services/order-service';
import { generateQrToken } from '../../src/domain/session/qr-token';
import type { Db } from '../../src/server/services/order-service';

let ctx: TestContext;
let db: Db;

interface Fixtures {
  waiterId: string;
  t11: { id: string; token: string };
  t12: { id: string; token: string };
  t14: { id: string; token: string };
  pho: string;
}
let fx: Fixtures;

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
    alter sequence order_number_seq restart with 1001;
    alter sequence session_number_seq restart with 1;
  `);

  const [waiter] = await db
    .insert(users)
    .values({ email: 'anna@asiaway.test', passwordHash: 'x', displayName: 'Anna' })
    .returning();

  const mkTable = async (tableNumber: string) => {
    const token = generateQrToken();
    const [row] = await db
      .insert(restaurantTables)
      .values({ tableNumber, displayName: `Table ${tableNumber}`, qrToken: token })
      .returning();
    return { id: row!.id, token };
  };

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
      nameDe: 'Rindfleisch-Nudelsuppe',
      nameVi: 'Phở bò',
      descriptionEn: 'd',
      descriptionDe: 'd',
      descriptionVi: 'd',
      priceCents: 2450,
      allergenCodes: ['D', 'F'],
      sortOrder: 1,
    })
    .returning();

  fx = {
    waiterId: waiter!.id,
    t11: await mkTable('11'),
    t12: await mkTable('12'),
    t14: await mkTable('14'),
    pho: item!.id,
  };
});

describe('QR scan and session creation', () => {
  it('creates a session on the first scan and reuses it on the second', async () => {
    const first = await resolveScan(db, { qrToken: fx.t11.token });
    expect(first.isNewSession).toBe(true);
    expect(first.tableNumber).toBe('11');

    const second = await resolveScan(db, {
      qrToken: fx.t11.token,
      existingDeviceToken: first.deviceToken,
    });
    expect(second.isNewSession).toBe(false);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.deviceId).toBe(first.deviceId);
  });

  it('gives a second phone at the same table its own device but the same session', async () => {
    const phoneA = await resolveScan(db, { qrToken: fx.t11.token });
    const phoneB = await resolveScan(db, { qrToken: fx.t11.token });
    expect(phoneB.sessionId).toBe(phoneA.sessionId);
    expect(phoneB.deviceId).not.toBe(phoneA.deviceId);
  });

  it('refuses an unknown token without revealing anything about real tables', async () => {
    await expect(resolveScan(db, { qrToken: generateQrToken() })).rejects.toMatchObject({
      code: 'QR_INVALID',
    });
    await expect(resolveScan(db, { qrToken: 'not-a-token' })).rejects.toMatchObject({
      code: 'QR_INVALID',
    });
  });

  it('refuses a deactivated table', async () => {
    await db
      .update(restaurantTables)
      .set({ isActive: false })
      .where(eq(restaurantTables.id, fx.t11.id));
    await expect(resolveScan(db, { qrToken: fx.t11.token })).rejects.toMatchObject({
      code: 'QR_INVALID',
    });
  });

  it('audits the session opening', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.sessionId, scan.sessionId));
    expect(events.map((e) => e.action)).toContain('SESSION_OPENED');
  });

  it('keeps two tables completely separate', async () => {
    const a = await resolveScan(db, { qrToken: fx.t11.token });
    const b = await resolveScan(db, { qrToken: fx.t12.token });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.tableId).not.toBe(b.tableId);
  });
});

describe('combined tables — lowest number anchors the session (decision E4)', () => {
  beforeEach(async () => {
    const [group] = await db
      .insert(tableGroups)
      .values({ groupName: 'Party of 8', status: 'ACTIVE', qrPolicy: 'ANY_MEMBER' })
      .returning();
    await db.insert(tableGroupMembers).values([
      { tableGroupId: group!.id, tableId: fx.t12.id },
      { tableGroupId: group!.id, tableId: fx.t14.id },
      { tableGroupId: group!.id, tableId: fx.t11.id },
    ]);
  });

  it('routes a scan of any joined table to the lowest-numbered table session', async () => {
    const fromT14 = await resolveScan(db, { qrToken: fx.t14.token });
    expect(fromT14.isCombined).toBe(true);
    expect(fromT14.tableNumber).toBe('11'); // the anchor
    expect(fromT14.scannedTableNumber).toBe('14');

    const fromT12 = await resolveScan(db, { qrToken: fx.t12.token });
    expect(fromT12.sessionId).toBe(fromT14.sessionId);

    const fromT11 = await resolveScan(db, { qrToken: fx.t11.token });
    expect(fromT11.sessionId).toBe(fromT14.sessionId);
  });

  it('puts orders from every joined table into the one session', async () => {
    const a = await resolveScan(db, { qrToken: fx.t14.token });
    const b = await resolveScan(db, { qrToken: fx.t12.token });

    await submitOrder(db, {
      sessionId: a.sessionId,
      deviceId: a.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    await submitOrder(db, {
      sessionId: b.sessionId,
      deviceId: b.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 2 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(diningSessions)
      .where(sql`${diningSessions.status} <> 'CLOSED'`);
    expect(rows[0]!.n).toBe(1);
  });
});

describe('checkout request', () => {
  it('creates one notification and leaves the session OPEN', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    const result = await requestCheckout(db, { sessionId: scan.sessionId, deviceId: scan.deviceId });
    expect(result.alreadyRequested).toBe(false);

    const [session] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, scan.sessionId));
    expect(session!.status).toBe('CHECKOUT_REQUESTED');
    expect(session!.status).not.toBe('CLOSED');
    expect(session!.checkoutRequestedAt).not.toBeNull();

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.sessionId, scan.sessionId));
    expect(notes.filter((n) => n.type === 'CHECKOUT_REQUESTED')).toHaveLength(1);
  });

  it('is idempotent: pressing twice does not summon the waiter twice', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    const first = await requestCheckout(db, { sessionId: scan.sessionId, deviceId: null });
    const second = await requestCheckout(db, { sessionId: scan.sessionId, deviceId: null });

    expect(second.alreadyRequested).toBe(true);
    expect(second.requestedAt.getTime()).toBe(first.requestedAt.getTime());

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'CHECKOUT_REQUESTED'));
    expect(notes).toHaveLength(1);
  });

  it('still accepts a further order after the bill was requested', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await requestCheckout(db, { sessionId: scan.sessionId, deviceId: null });

    const order = await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    expect(order.orderNumber).toBeGreaterThan(0);

    const [session] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, scan.sessionId));
    // The request is remembered even though the status moved on.
    expect(session!.checkoutRequestedAt).not.toBeNull();
  });
});

describe('closing a session', () => {
  it('refuses while an order still awaits the waiter', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    await expect(
      closeSession(db, { sessionId: scan.sessionId, userId: fx.waiterId }),
    ).rejects.toMatchObject({ code: 'SESSION_HAS_UNRESOLVED_ORDERS' });
  });

  it('allows a forced close with a reason, and records it', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    await closeSession(db, {
      sessionId: scan.sessionId,
      userId: fx.waiterId,
      force: true,
      reason: 'guest left without ordering more',
    });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.sessionId, scan.sessionId));
    const forced = events.find((e) => e.action === 'SESSION_FORCE_CLOSED');
    expect(forced).toBeDefined();
    expect((forced!.metadata as any).reason).toBe('guest left without ordering more');
  });

  it('refuses a forced close with no reason', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    await expect(
      closeSession(db, { sessionId: scan.sessionId, userId: fx.waiterId, force: true }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('closes cleanly once every order is confirmed, and frees the table', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    const order = await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    await confirmOrder(db, { orderId: order.orderId, userId: fx.waiterId });
    await closeSession(db, { sessionId: scan.sessionId, userId: fx.waiterId });

    const overview = await getTableOverview(db);
    const table11 = overview.find((t) => t.tableNumber === '11');
    expect(table11!.sessionId).toBeNull(); // AVAILABLE is the absence of a session

    // And a later guest gets a brand-new session, not the old one.
    const next = await resolveScan(db, { qrToken: fx.t11.token });
    expect(next.isNewSession).toBe(true);
    expect(next.sessionId).not.toBe(scan.sessionId);
  });

  it('acknowledges outstanding notifications when the session closes', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await requestCheckout(db, { sessionId: scan.sessionId, deviceId: null });
    await closeSession(db, { sessionId: scan.sessionId, userId: fx.waiterId });

    const pending = await db
      .select()
      .from(notifications)
      .where(eq(notifications.status, 'PENDING'));
    expect(pending).toHaveLength(0);
  });
});

describe('a table that turned over without anyone asking for the bill', () => {
  it('gives the next guests a clean session instead of the last party\'s bill', async () => {
    const firstParty = await resolveScan(db, { qrToken: fx.t11.token });
    await submitOrder(db, {
      sessionId: firstParty.sessionId,
      deviceId: firstParty.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 2 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    // They leave. Nobody presses anything.
    await db
      .update(diningSessions)
      .set({ lastActivityAt: new Date(Date.now() - 5 * 3600_000) })
      .where(eq(diningSessions.id, firstParty.sessionId));

    // New guests sit down and scan the same code.
    const secondParty = await resolveScan(db, { qrToken: fx.t11.token });

    expect(secondParty.isNewSession).toBe(true);
    expect(secondParty.sessionId).not.toBe(firstParty.sessionId);

    // Crucially, they see none of the previous party's orders.
    const theirOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.sessionId, secondParty.sessionId));
    expect(theirOrders).toHaveLength(0);

    const [old] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, firstParty.sessionId));
    expect(old!.status).toBe('CLOSED');
  });

  it('records who closed it and why', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await db
      .update(diningSessions)
      .set({ lastActivityAt: new Date(Date.now() - 5 * 3600_000) })
      .where(eq(diningSessions.id, scan.sessionId));

    await resolveScan(db, { qrToken: fx.t11.token });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.sessionId, scan.sessionId));
    const closed = events.find((e) => e.action === 'SESSION_CLOSED')!;
    expect(closed.actorType).toBe('SYSTEM');
    expect((closed.metadata as any).trigger).toBe('scan');
  });

  it('does NOT disturb a session that is merely quiet between courses', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await db
      .update(diningSessions)
      .set({ lastActivityAt: new Date(Date.now() - 45 * 60_000) })
      .where(eq(diningSessions.id, scan.sessionId));

    const again = await resolveScan(db, { qrToken: fx.t11.token });
    expect(again.isNewSession).toBe(false);
    expect(again.sessionId).toBe(scan.sessionId);
  });

  it('keeps the abandoned orders and their history intact', async () => {
    const firstParty = await resolveScan(db, { qrToken: fx.t11.token });
    const order = await submitOrder(db, {
      sessionId: firstParty.sessionId,
      deviceId: firstParty.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    await db
      .update(diningSessions)
      .set({ lastActivityAt: new Date(Date.now() - 5 * 3600_000) })
      .where(eq(diningSessions.id, firstParty.sessionId));

    await resolveScan(db, { qrToken: fx.t11.token });

    // The restaurant still needs this: the food may well have been served.
    const kept = await db.select().from(orders).where(eq(orders.id, order.orderId));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.totalCents).toBe(2450);
  });
});

describe('stale sessions (proposal E6)', () => {
  it('auto-closes a session idle beyond the timeout, with a SYSTEM audit event', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await db
      .update(diningSessions)
      .set({ lastActivityAt: new Date(Date.now() - 5 * 3600_000) })
      .where(eq(diningSessions.id, scan.sessionId));

    const closed = await closeIdleSessions(db, 4);
    expect(closed).toBe(1);

    const [session] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, scan.sessionId));
    expect(session!.status).toBe('CLOSED');

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.sessionId, scan.sessionId));
    const auto = events.find((e) => (e.metadata as any)?.auto === true);
    expect(auto!.actorType).toBe('SYSTEM');
  });

  it('leaves an active session alone', async () => {
    await resolveScan(db, { qrToken: fx.t11.token });
    expect(await closeIdleSessions(db, 4)).toBe(0);
  });
});

describe('waiter-opened sessions', () => {
  it('opens a session for a walk-in seated before scanning', async () => {
    const { sessionId } = await openSessionForTable(db, {
      tableId: fx.t11.id,
      userId: fx.waiterId,
    });
    expect(sessionId).toBeTruthy();

    // The guest's later scan joins that same session.
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    expect(scan.sessionId).toBe(sessionId);
    expect(scan.isNewSession).toBe(false);
  });

  it('refuses to open a second session for an occupied table', async () => {
    await openSessionForTable(db, { tableId: fx.t11.id, userId: fx.waiterId });
    await expect(
      openSessionForTable(db, { tableId: fx.t11.id, userId: fx.waiterId }),
    ).rejects.toMatchObject({ code: 'SESSION_ALREADY_OPEN' });
  });
});

describe('sold-out management', () => {
  it('blocks the guest from ordering, and is audited', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await setAvailability(db, {
      menuItemId: fx.pho,
      isAvailable: false,
      userId: fx.waiterId,
      reason: 'kitchen ran out',
    });

    await expect(
      submitOrder(db, {
        sessionId: scan.sessionId,
        deviceId: scan.deviceId,
        lines: [{ menuItemId: fx.pho, quantity: 1 }],
        note: null,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'ITEMS_UNAVAILABLE' });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'MENU_ITEM_SOLD_OUT'));
    expect(events).toHaveLength(1);
    expect((events[0]!.metadata as any).reason).toBe('kitchen ran out');
  });

  it('restores availability and lets the guest order again', async () => {
    const scan = await resolveScan(db, { qrToken: fx.t11.token });
    await setAvailability(db, { menuItemId: fx.pho, isAvailable: false, userId: fx.waiterId });
    await setAvailability(db, { menuItemId: fx.pho, isAvailable: true, userId: fx.waiterId });

    const order = await submitOrder(db, {
      sessionId: scan.sessionId,
      deviceId: scan.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    expect(order.totalCents).toBe(2450);

    const restored = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'MENU_ITEM_RESTORED'));
    expect(restored).toHaveLength(1);
  });

  it('does not write an audit event when nothing actually changed', async () => {
    await setAvailability(db, { menuItemId: fx.pho, isAvailable: true, userId: fx.waiterId });
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityType, 'MENU_ITEM'));
    expect(events).toHaveLength(0);
  });
});
