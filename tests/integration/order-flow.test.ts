import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import {
  auditEvents,
  customerDevices,
  diningSessions,
  menuCategories,
  menuItems,
  notifications,
  orderItems,
  orderRevisions,
  orders,
  restaurantTables,
  users,
} from '../../src/server/db/schema';
import {
  confirmOrder,
  createOrderForTable,
  editOrder,
  editOrderAsCustomer,
  finaliseExpiredOrders,
  openOrderForReview,
  reopenOrder,
  sendOrderNow,
  submitOrder,
} from '../../src/server/services/order-service';
import type { Db } from '../../src/server/services/order-service';
import { DomainError } from '../../src/domain/errors';
import { generateQrToken } from '../../src/domain/session/qr-token';

let ctx: TestContext;
let db: Db;

interface Fixtures {
  tableId: string;
  tableBId: string;
  sessionId: string;
  sessionBId: string;
  deviceId: string;
  waiterId: string;
  pho: string;
  coke: string;
  coffee: string;
  soldOut: string;
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
  // TRUNCATE, not DELETE: the append-only triggers correctly refuse a DELETE on
  // audit_events and order_revisions. Row-level triggers do not fire on
  // TRUNCATE, and TRUNCATE needs table-owner rights that the production
  // application role is deliberately not granted — so this is a test-harness
  // privilege, not a hole in the guarantee.
  await ctx.client.exec(`
    truncate audit_events, order_revisions, order_items, order_notes,
             notifications, idempotency_keys, orders, customer_devices,
             dining_sessions, menu_items, menu_categories, restaurant_tables,
             users
    restart identity cascade;
    alter sequence order_number_seq restart with 1001;
    alter sequence session_number_seq restart with 1;
  `);

  const [waiter] = await db
    .insert(users)
    .values({ email: 'anna@asiaway.test', passwordHash: 'x', displayName: 'Anna' })
    .returning();

  const [tableA] = await db
    .insert(restaurantTables)
    .values({ tableNumber: '01', displayName: 'Table 01', qrToken: generateQrToken() })
    .returning();
  const [tableB] = await db
    .insert(restaurantTables)
    .values({ tableNumber: '02', displayName: 'Table 02', qrToken: generateQrToken() })
    .returning();

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

  const mk = async (key: string, nameEn: string, priceCents: number, isAvailable = true) => {
    const [row] = await db
      .insert(menuItems)
      .values({
        categoryId: category!.id,
        externalKey: key,
        dishNumber: '40',
        nameEn,
        nameDe: nameEn,
        nameVi: nameEn,
        descriptionEn: 'd',
        descriptionDe: 'd',
        descriptionVi: 'd',
        priceCents,
        allergenCodes: ['D', 'F'],
        sortOrder: 1,
        isAvailable,
      })
      .returning();
    return row!.id;
  };

  const [sessionA] = await db
    .insert(diningSessions)
    .values({ primaryTableId: tableA!.id, status: 'OCCUPIED' })
    .returning();
  const [sessionB] = await db
    .insert(diningSessions)
    .values({ primaryTableId: tableB!.id, status: 'OCCUPIED' })
    .returning();

  const [device] = await db
    .insert(customerDevices)
    .values({ sessionId: sessionA!.id, deviceTokenHash: randomUUID() })
    .returning();

  fx = {
    tableId: tableA!.id,
    tableBId: tableB!.id,
    sessionId: sessionA!.id,
    sessionBId: sessionB!.id,
    deviceId: device!.id,
    waiterId: waiter!.id,
    pho: await mk('ns:40:pho-bo', 'Beef Noodle Soup', 2450),
    coke: await mk('dr:1:coke', 'Coke', 500),
    coffee: await mk('dr:2:coffee', 'Vietnamese Coffee', 550),
    soldOut: await mk('ns:41:pho-ga', 'Chicken Noodle Soup', 2350, false),
  };
});

const submit = (over: Partial<Parameters<typeof submitOrder>[1]> = {}) =>
  submitOrder(db, {
    sessionId: fx.sessionId,
    deviceId: fx.deviceId,
    lines: [
      { menuItemId: fx.pho, quantity: 2 },
      { menuItemId: fx.coke, quantity: 1 },
    ],
    note: null,
    idempotencyKey: randomUUID(),
    ...over,
  });

describe('order submission', () => {
  it('creates an order with a server-computed total and a server timestamp', async () => {
    const before = Date.now();
    const result = await submit();
    expect(result.totalCents).toBe(2450 * 2 + 500);
    expect(result.orderNumber).toBe(1001);
    expect(result.submittedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(result.replayed).toBe(false);
  });

  it('ignores any price the client tries to send', async () => {
    const result = await submitOrder(db, {
      sessionId: fx.sessionId,
      deviceId: fx.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 1, unitPriceCents: 1 } as never],
      note: null,
      idempotencyKey: randomUUID(),
    });
    expect(result.totalCents).toBe(2450);
  });

  it('writes revision 0 as the immutable original submission', async () => {
    const { orderId } = await submit();
    const revs = await db
      .select()
      .from(orderRevisions)
      .where(eq(orderRevisions.orderId, orderId));
    expect(revs).toHaveLength(1);
    expect(revs[0]!.revisionNumber).toBe(0);
    expect(revs[0]!.revisionType).toBe('ORIGINAL_SUBMISSION');
    expect(revs[0]!.beforeSnapshot).toBeNull();
    expect((revs[0]!.afterSnapshot as any).totalCents).toBe(5400);
  });

  it('audits the submission but tells no waiter yet', async () => {
    const { orderId } = await submit();
    const events = await db.select().from(auditEvents).where(eq(auditEvents.orderId, orderId));
    expect(events.map((e) => e.action)).toEqual(['ORDER_SUBMITTED']);
    expect(events[0]!.actorType).toBe('CUSTOMER');

    // The guest still owns this order. Notifying now would put something the
    // guest is still changing into the waiter's queue.
    const notes = await db.select().from(notifications).where(eq(notifications.orderId, orderId));
    expect(notes).toHaveLength(0);
  });

  it('notifies the waiter once the guest sends it', async () => {
    const { orderId, orderNumber } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    const notes = await db.select().from(notifications).where(eq(notifications.orderId, orderId));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.status).toBe('PENDING');
    expect((notes[0]!.payload as any).orderNumber).toBe(orderNumber);
    expect((notes[0]!.payload as any).autoConfirmed).toBe(true);
  });

  it('leaves the session alone while the guest still holds the order', async () => {
    await submit();
    const [session] = await db.select().from(diningSessions).where(eq(diningSessions.id, fx.sessionId));
    // Nothing is waiting on a waiter yet, so the table must not read as one
    // that needs attention.
    expect(session!.status).toBe('OCCUPIED');
  });

  it('confirms itself when the guest sends it, with no waiter involved', async () => {
    const { orderId } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('CONFIRMED');
    expect(order!.confirmedBy, 'nobody on staff confirmed this').toBeNull();

    const events = await db.select().from(auditEvents).where(eq(auditEvents.orderId, orderId));
    const auto = events.find((e) => e.action === 'ORDER_AUTO_CONFIRMED');
    expect(auto).toBeDefined();
    expect(auto!.actorType).toBe('SYSTEM');
    expect((auto!.metadata as any).trigger).toBe('sent_by_guest');
  });

  it('stores the free-text special request', async () => {
    const { orderId } = await submit({ note: 'No coriander, please.' });
    const revs = await db.select().from(orderRevisions).where(eq(orderRevisions.orderId, orderId));
    expect((revs[0]!.afterSnapshot as any).customerNote).toBe('No coriander, please.');
  });

  it('refuses a sold-out item and writes nothing', async () => {
    await expect(submit({ lines: [{ menuItemId: fx.soldOut, quantity: 1 }] })).rejects.toMatchObject({
      code: 'ITEMS_UNAVAILABLE',
    });
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it('refuses to add to a closed session', async () => {
    await db.update(diningSessions).set({ status: 'CLOSED' }).where(eq(diningSessions.id, fx.sessionId));
    await expect(submit()).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
  });
});

describe('duplicate submission protection', () => {
  it('creates exactly one order when the same key is sent twice (double tap)', async () => {
    const key = randomUUID();
    const first = await submit({ idempotencyKey: key });
    const second = await submit({ idempotencyKey: key });

    expect(second.replayed).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it('survives ten concurrent retries of the same request', async () => {
    const key = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => submit({ idempotencyKey: key })),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThan(0);
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it('still allows a genuinely new order with a new key', async () => {
    await submit();
    await submit();
    expect(await db.select().from(orders)).toHaveLength(2);
  });
});

describe('order numbering under concurrency', () => {
  it('gives 20 simultaneous submissions 20 distinct order numbers', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => submit({ idempotencyKey: randomUUID() })),
    );
    const numbers = results.map((r) => r.orderNumber);
    expect(new Set(numbers).size).toBe(20);
    expect(Math.min(...numbers)).toBe(1001);
  });
});

describe('waiter review, edit and confirmation', () => {
  it('opening an order records it without creating a revision', async () => {
    const { orderId } = await submit();
    await openOrderForReview(db, { orderId, userId: fx.waiterId });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('EMPLOYEE_REVIEW');
    expect(order!.openedByWaiterAt).not.toBeNull();
    expect(order!.currentRevisionNumber).toBe(0);

    const revs = await db.select().from(orderRevisions).where(eq(orderRevisions.orderId, orderId));
    expect(revs).toHaveLength(1);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.orderId, orderId));
    expect(events.map((e) => e.action)).toContain('ORDER_OPENED_FOR_REVIEW');
  });

  it('reproduces the brief worked example end to end, preserving the original', async () => {
    // Customer submits 2x Pho + 1x Coke
    const { orderId } = await submit();
    await openOrderForReview(db, { orderId, userId: fx.waiterId });

    // Revision 1: waiter reduces to 1x Pho + 1x Coke
    const r1 = await editOrder(db, {
      orderId,
      userId: fx.waiterId,
      lines: [
        { menuItemId: fx.pho, quantity: 1 },
        { menuItemId: fx.coke, quantity: 1 },
      ],
      reason: 'guest changed mind',
      expectedRevisionNumber: 0,
    });
    expect(r1.revisionNumber).toBe(1);
    expect(r1.totalCents).toBe(2950);

    // Revision 2: waiter adds a Vietnamese Coffee
    const r2 = await editOrder(db, {
      orderId,
      userId: fx.waiterId,
      lines: [
        { menuItemId: fx.pho, quantity: 1 },
        { menuItemId: fx.coke, quantity: 1 },
        { menuItemId: fx.coffee, quantity: 1 },
      ],
      expectedRevisionNumber: 1,
    });
    expect(r2.revisionNumber).toBe(2);
    expect(r2.totalCents).toBe(3500);

    // Revision 3: confirmation
    const confirmed = await confirmOrder(db, { orderId, userId: fx.waiterId });
    expect(confirmed.revisionNumber).toBe(3);
    expect(confirmed.totalCents).toBe(3500);

    const revs = await db
      .select()
      .from(orderRevisions)
      .where(eq(orderRevisions.orderId, orderId))
      .orderBy(asc(orderRevisions.revisionNumber));

    expect(revs.map((r) => r.revisionType)).toEqual([
      'ORIGINAL_SUBMISSION',
      'WAITER_EDIT',
      'WAITER_EDIT',
      'FINAL_CONFIRMED',
    ]);
    expect(revs.map((r) => r.totalCentsAfter)).toEqual([5400, 2950, 3500, 3500]);

    // The original customer submission is still exactly what the guest sent.
    const original = revs[0]!.afterSnapshot as any;
    expect(original.items).toHaveLength(2);
    expect(original.items.find((i: any) => i.nameEn === 'Beef Noodle Soup').quantity).toBe(2);
    expect(original.totalCents).toBe(5400);

    // Every revision carries its predecessor, so any version reconstructs.
    expect((revs[1]!.beforeSnapshot as any).totalCents).toBe(5400);
    expect((revs[2]!.beforeSnapshot as any).totalCents).toBe(2950);
    expect(revs[0]!.reason).toBeNull();
    expect(revs[1]!.reason).toBe('guest changed mind');
  });

  it('records one audit event per individual change, with before and after values', async () => {
    const { orderId } = await submit();
    // A waiter must take the order over before editing it, which is itself
    // recorded — the guest's window is not something staff edit behind.
    await openOrderForReview(db, { orderId, userId: fx.waiterId });
    await editOrder(db, {
      orderId,
      userId: fx.waiterId,
      lines: [
        { menuItemId: fx.pho, quantity: 1 },
        { menuItemId: fx.coffee, quantity: 1 },
      ],
      expectedRevisionNumber: 0,
    });

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.orderId, orderId))
      .orderBy(asc(auditEvents.id));

    const actions = events.map((e) => e.action);
    expect(actions).toContain('ORDER_ITEM_QUANTITY_CHANGED');
    expect(actions).toContain('ORDER_ITEM_ADDED');
    expect(actions).toContain('ORDER_ITEM_REMOVED');

    const qty = events.find((e) => e.action === 'ORDER_ITEM_QUANTITY_CHANGED')!;
    expect(qty.beforeValue).toBe(2);
    expect(qty.afterValue).toBe(1);
    expect(qty.actorUserId).toBe(fx.waiterId);
  });

  it('rejects a stale edit from a second device', async () => {
    const { orderId } = await submit();
    await openOrderForReview(db, { orderId, userId: fx.waiterId });
    await editOrder(db, {
      orderId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      expectedRevisionNumber: 0,
    });
    await expect(
      editOrder(db, {
        orderId,
        userId: fx.waiterId,
        lines: [{ menuItemId: fx.pho, quantity: 5 }],
        expectedRevisionNumber: 0,
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('creates no revision when an edit changes nothing', async () => {
    const { orderId } = await submit();
    await openOrderForReview(db, { orderId, userId: fx.waiterId });
    const res = await editOrder(db, {
      orderId,
      userId: fx.waiterId,
      lines: [
        { menuItemId: fx.pho, quantity: 2 },
        { menuItemId: fx.coke, quantity: 1 },
      ],
      expectedRevisionNumber: 0,
    });
    expect(res.changed).toBe(false);
    expect(await db.select().from(orderRevisions).where(eq(orderRevisions.orderId, orderId))).toHaveLength(1);
  });

  it('refuses to edit a confirmed order', async () => {
    const { orderId } = await submit();
    await confirmOrder(db, { orderId, userId: fx.waiterId });
    await expect(
      editOrder(db, {
        orderId,
        userId: fx.waiterId,
        lines: [{ menuItemId: fx.pho, quantity: 1 }],
        expectedRevisionNumber: 1,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_EDITABLE' });
  });

  it('confirming clears the order from the pending notification queue', async () => {
    // The notification only exists once the order has left the guest's hands.
    const { orderId } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    // An emergency correction: the guest calls someone over after sending.
    await reopenOrder(db, { orderId, userId: fx.waiterId, reason: 'guest changed their mind' });
    await confirmOrder(db, { orderId, userId: fx.waiterId });

    const notes = await db.select().from(notifications).where(eq(notifications.orderId, orderId));
    expect(notes[0]!.status).toBe('ACKNOWLEDGED');
    expect(notes[0]!.acknowledgedBy).toBe(fx.waiterId);
  });

  it('records the implicit review step when a waiter confirms without opening first', async () => {
    const { orderId } = await submit();
    await confirmOrder(db, { orderId, userId: fx.waiterId });
    const events = await db.select().from(auditEvents).where(eq(auditEvents.orderId, orderId));
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['ORDER_SUBMITTED', 'ORDER_OPENED_FOR_REVIEW', 'ORDER_CONFIRMED']),
    );
  });
});

describe('additional orders in the same session', () => {
  it('gives the second order a new number and leaves the first untouched', async () => {
    const first = await submit();
    const firstRevsBefore = await db
      .select()
      .from(orderRevisions)
      .where(eq(orderRevisions.orderId, first.orderId));

    const second = await submit({ lines: [{ menuItemId: fx.coffee, quantity: 1 }] });

    expect(second.orderNumber).toBe(first.orderNumber + 1);
    expect(second.orderId).not.toBe(first.orderId);

    const firstRevsAfter = await db
      .select()
      .from(orderRevisions)
      .where(eq(orderRevisions.orderId, first.orderId));
    expect(firstRevsAfter).toEqual(firstRevsBefore);

    const firstItems = await db.select().from(orderItems).where(eq(orderItems.orderId, first.orderId));
    expect(firstItems).toHaveLength(2);
  });

  it('keeps both orders in the same session', async () => {
    const a = await submit();
    const b = await submit();
    const rows = await db.select().from(orders).where(eq(orders.sessionId, fx.sessionId));
    expect(rows.map((r) => r.id).sort()).toEqual([a.orderId, b.orderId].sort());
  });
});

describe('history is append-only', () => {
  it('refuses to update or delete an audit event', async () => {
    await submit();
    await expect(ctx.client.exec('update audit_events set action = 99')).rejects.toThrow(/append-only/i);
    await expect(ctx.client.exec('delete from audit_events')).rejects.toThrow(/append-only/i);
  });

  it('refuses to update or delete a revision', async () => {
    await submit();
    await expect(ctx.client.exec('update order_revisions set total_cents_after = 0')).rejects.toThrow(
      /append-only/i,
    );
    await expect(ctx.client.exec('delete from order_revisions')).rejects.toThrow(/append-only/i);
  });

  it('keeps history after the session is closed', async () => {
    const { orderId } = await submit();
    await confirmOrder(db, { orderId, userId: fx.waiterId });
    await db
      .update(diningSessions)
      .set({ status: 'CLOSED', closedAt: new Date() })
      .where(eq(diningSessions.id, fx.sessionId));

    const revs = await db.select().from(orderRevisions).where(eq(orderRevisions.orderId, orderId));
    expect(revs.length).toBeGreaterThan(0);
  });
});

describe('an order taken by a waiter at the table', () => {
  it('is confirmed immediately and attributed to the waiter, not a guest', async () => {
    const result = await createOrderForTable(db, {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.pho, quantity: 2 }],
      note: 'no coriander',
      idempotencyKey: randomUUID(),
    });

    expect(result.totalCents).toBe(4900);

    const [order] = await db.select().from(orders).where(eq(orders.id, result.orderId));
    expect(order!.status).toBe('CONFIRMED');
    expect(order!.confirmedBy).toBe(fx.waiterId);
    // Nothing pretends a guest pressed a button.
    expect(order!.submittedByDeviceId).toBeNull();
  });

  it('records the same revision shape as a guest order, with WAITER as the actor', async () => {
    const result = await createOrderForTable(db, {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const revs = await db
      .select()
      .from(orderRevisions)
      .where(eq(orderRevisions.orderId, result.orderId))
      .orderBy(asc(orderRevisions.revisionNumber));

    expect(revs.map((r) => r.revisionType)).toEqual(['ORIGINAL_SUBMISSION', 'FINAL_CONFIRMED']);
    expect(revs.every((r) => r.actorType === 'WAITER')).toBe(true);
    expect(revs.every((r) => r.actorUserId === fx.waiterId)).toBe(true);
  });

  it('audits both the taking and the confirming', async () => {
    const result = await createOrderForTable(db, {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const events = await db.select().from(auditEvents).where(eq(auditEvents.orderId, result.orderId));
    expect(events.map((e) => e.action).sort()).toEqual(['ORDER_CONFIRMED', 'ORDER_SUBMITTED']);
    expect(events.every((e) => e.actorType === 'WAITER')).toBe(true);
    expect(events.every((e) => (e.metadata as any).takenByStaff === true)).toBe(true);
  });

  it('never lands in the pending queue, because there is nothing to review', async () => {
    await createOrderForTable(db, {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const pending = await db
      .select()
      .from(orders)
      .where(inArray(orders.status, ['SUBMITTED', 'EMPLOYEE_REVIEW']));
    expect(pending).toHaveLength(0);
  });

  it('opens a session when the table is free, and joins the open one otherwise', async () => {
    // fx.tableId already has an open session from the fixture.
    const first = await createOrderForTable(db, {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    const second = await createOrderForTable(db, {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.coke, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });

    const [a] = await db.select().from(orders).where(eq(orders.id, first.orderId));
    const [b] = await db.select().from(orders).where(eq(orders.id, second.orderId));
    expect(a!.sessionId).toBe(b!.sessionId);
    expect(b!.orderNumber).toBe(a!.orderNumber + 1);
  });

  it('lets staff order a dish the guest could not, because they know the kitchen', async () => {
    const result = await createOrderForTable(db, {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.soldOut, quantity: 1 }],
      note: null,
      idempotencyKey: randomUUID(),
    });
    expect(result.totalCents).toBe(2350);
  });

  it('survives a double tap on the tablet', async () => {
    const key = randomUUID();
    const input = {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.pho, quantity: 1 }],
      note: null,
      idempotencyKey: key,
    };
    const first = await createOrderForTable(db, input);
    const second = await createOrderForTable(db, input);

    expect(second.replayed).toBe(true);
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it('still computes the total from the database, not the tablet', async () => {
    const result = await createOrderForTable(db, {
      tableId: fx.tableId,
      userId: fx.waiterId,
      lines: [{ menuItemId: fx.pho, quantity: 2, unitPriceCents: 1 } as never],
      note: null,
      idempotencyKey: randomUUID(),
    });
    expect(result.totalCents).toBe(4900);
  });
});

describe('session status follows the orders', () => {
  it('returns the session to OCCUPIED once every order is confirmed', async () => {
    // Regression: confirming an order used to leave the session in ORDER_PENDING
    // forever, so the dashboard kept showing "order waiting" on a table with
    // nothing waiting, and closing the session was refused.
    //
    // Reaching ORDER_PENDING now takes a waiter taking an order over, because
    // an order that confirms itself never waits on anybody.
    const { orderId } = await submit();
    await openOrderForReview(db, { orderId, userId: fx.waiterId });

    let [session] = await db.select().from(diningSessions).where(eq(diningSessions.id, fx.sessionId));
    expect(session!.status).toBe('ORDER_PENDING');

    await confirmOrder(db, { orderId, userId: fx.waiterId });

    [session] = await db.select().from(diningSessions).where(eq(diningSessions.id, fx.sessionId));
    expect(session!.status).toBe('OCCUPIED');
  });

  it('stays ORDER_PENDING while a second order is still waiting', async () => {
    const first = await submit();
    const second = await submit();
    await openOrderForReview(db, { orderId: first.orderId, userId: fx.waiterId });
    await openOrderForReview(db, { orderId: second.orderId, userId: fx.waiterId });
    await confirmOrder(db, { orderId: first.orderId, userId: fx.waiterId });

    const [session] = await db.select().from(diningSessions).where(eq(diningSessions.id, fx.sessionId));
    expect(session!.status).toBe('ORDER_PENDING');
  });

  it('does not lose a checkout request when the last order is confirmed', async () => {
    const { orderId } = await submit();
    await db
      .update(diningSessions)
      .set({ status: 'CHECKOUT_REQUESTED', checkoutRequestedAt: new Date() })
      .where(eq(diningSessions.id, fx.sessionId));

    await confirmOrder(db, { orderId, userId: fx.waiterId });

    const [session] = await db.select().from(diningSessions).where(eq(diningSessions.id, fx.sessionId));
    expect(session!.status).toBe('CHECKOUT_REQUESTED');
    expect(session!.checkoutRequestedAt).not.toBeNull();
  });
});

describe('session isolation', () => {
  it('never mixes orders from two tables', async () => {
    await submit();
    await submit({ sessionId: fx.sessionBId, deviceId: null });

    const aOrders = await db.select().from(orders).where(eq(orders.sessionId, fx.sessionId));
    const bOrders = await db.select().from(orders).where(eq(orders.sessionId, fx.sessionBId));

    expect(aOrders).toHaveLength(1);
    expect(bOrders).toHaveLength(1);
    expect(aOrders[0]!.tableId).toBe(fx.tableId);
    expect(bOrders[0]!.tableId).toBe(fx.tableBId);
  });
});

describe('one open session per table', () => {
  it('is enforced by the database, not by application code', async () => {
    await expect(
      ctx.client.exec(
        `insert into dining_sessions (primary_table_id, status)
         values ('${fx.tableId}', 'OCCUPIED')`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('allows a new session once the previous one is closed', async () => {
    await db
      .update(diningSessions)
      .set({ status: 'CLOSED', closedAt: new Date() })
      .where(eq(diningSessions.id, fx.sessionId));

    const [fresh] = await db
      .insert(diningSessions)
      .values({ primaryTableId: fx.tableId, status: 'OCCUPIED' })
      .returning();

    expect(fresh!.id).not.toBe(fx.sessionId);
    expect(fresh!.sessionNumber).toBeGreaterThan(0);
  });
});

describe('menu edits never rewrite history', () => {
  it('keeps the ordered name and price even after the menu item changes', async () => {
    const { orderId } = await submit();
    await db
      .update(menuItems)
      .set({ nameEn: 'Renamed Soup', priceCents: 9900 })
      .where(eq(menuItems.id, fx.pho));

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const line = items.find((i) => i.menuItemId === fx.pho)!;
    expect(line.nameEn).toBe('Beef Noodle Soup');
    expect(line.unitPriceCents).toBe(2450);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.totalCents).toBe(5400);
  });
});

describe('domain errors carry stable codes', () => {
  it('exposes a machine-readable code and no internal detail', async () => {
    try {
      await submit({ lines: [{ menuItemId: fx.soldOut, quantity: 1 }] });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('ITEMS_UNAVAILABLE');
    }
  });
});
