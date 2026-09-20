import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import {
  auditEvents,
  customerDevices,
  diningSessions,
  menuCategories,
  menuItems,
  notifications,
  orderRevisions,
  orders,
  restaurantTables,
  users,
} from '../../src/server/db/schema';
import {
  confirmOrder,
  editOrderAsCustomer,
  finaliseExpiredOrders,
  reopenOrder,
  sendOrderNow,
  submitOrder,
} from '../../src/server/services/order-service';
import { generateQrToken } from '../../src/domain/session/qr-token';
import type { Db } from '../../src/server/services/order-service';

let ctx: TestContext;
let db: Db;
let fx: {
  sessionId: string;
  deviceId: string;
  otherDeviceId: string;
  waiterId: string;
  pho: string;
  coke: string;
};

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

  const [tableA] = await db
    .insert(restaurantTables)
    .values({ tableNumber: '11', displayName: 'Table 11', qrToken: generateQrToken() })
    .returning();
  const [tableB] = await db
    .insert(restaurantTables)
    .values({ tableNumber: '12', displayName: 'Table 12', qrToken: generateQrToken() })
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

  const mk = async (key: string, nameEn: string, priceCents: number) => {
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
        allergenCodes: ['D'],
        sortOrder: 1,
      })
      .returning();
    return row!.id;
  };

  const [session] = await db
    .insert(diningSessions)
    .values({ primaryTableId: tableA!.id, status: 'OCCUPIED' })
    .returning();
  const [otherSession] = await db
    .insert(diningSessions)
    .values({ primaryTableId: tableB!.id, status: 'OCCUPIED' })
    .returning();

  const [device] = await db
    .insert(customerDevices)
    .values({ sessionId: session!.id, deviceTokenHash: randomUUID() })
    .returning();
  const [otherDevice] = await db
    .insert(customerDevices)
    .values({ sessionId: otherSession!.id, deviceTokenHash: randomUUID() })
    .returning();

  fx = {
    sessionId: session!.id,
    deviceId: device!.id,
    otherDeviceId: otherDevice!.id,
    waiterId: waiter!.id,
    pho: await mk('ns:40:pho', 'Beef Noodle Soup', 2450),
    coke: await mk('dr:1:coke', 'Coke', 500),
  };
});

const submit = () =>
  submitOrder(db, {
    sessionId: fx.sessionId,
    deviceId: fx.deviceId,
    lines: [{ menuItemId: fx.pho, quantity: 1 }],
    note: null,
    idempotencyKey: randomUUID(),
  });

/** Winds an order's window back into the past, as if the minute had elapsed. */
const expireWindow = (orderId: string) =>
  db
    .update(orders)
    .set({ customerWindowExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(orders.id, orderId));

describe('the guest keeps their order for a minute', () => {
  it('holds a new order in the guest’s hands, not the waiter’s', async () => {
    const { orderId, customerWindowExpiresAt } = await submit();

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('AWAITING_CUSTOMER');
    expect(customerWindowExpiresAt).toBeInstanceOf(Date);

    const seconds = (customerWindowExpiresAt!.getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(50);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  it('tells no waiter while the window is open', async () => {
    const { orderId } = await submit();
    const notes = await db.select().from(notifications).where(eq(notifications.orderId, orderId));
    expect(notes).toHaveLength(0);
  });

  it('lets the guest change what they ordered', async () => {
    const { orderId } = await submit();

    const result = await editOrderAsCustomer(db, {
      orderId,
      deviceId: fx.deviceId,
      lines: [
        { menuItemId: fx.pho, quantity: 2 },
        { menuItemId: fx.coke, quantity: 1 },
      ],
      note: 'no coriander',
    });

    expect(result.totalCents).toBe(2450 * 2 + 500);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.totalCents).toBe(2450 * 2 + 500);
    expect(order!.status, 'still theirs to change').toBe('AWAITING_CUSTOMER');
  });

  it('keeps the original submission intact behind the change', async () => {
    const { orderId } = await submit();
    await editOrderAsCustomer(db, {
      orderId,
      deviceId: fx.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 5 }],
      note: null,
    });

    const revisions = await db
      .select()
      .from(orderRevisions)
      .where(eq(orderRevisions.orderId, orderId))
      .orderBy(asc(orderRevisions.revisionNumber));

    expect(revisions[0]!.revisionType).toBe('ORIGINAL_SUBMISSION');
    expect(revisions[0]!.totalCentsAfter, 'what they first asked for').toBe(2450);
    expect(revisions[1]!.revisionType).toBe('CUSTOMER_EDIT');
    expect(revisions[1]!.actorType).toBe('CUSTOMER');
    expect(revisions[1]!.totalCentsBefore).toBe(2450);
    expect(revisions[1]!.totalCentsAfter).toBe(2450 * 5);
  });

  it('audits the guest’s change — with no waiter reviewing, this is the only record', async () => {
    const { orderId } = await submit();
    await editOrderAsCustomer(db, {
      orderId,
      deviceId: fx.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 3 }],
      note: null,
    });

    const events = await db.select().from(auditEvents).where(eq(auditEvents.orderId, orderId));
    const edit = events.find((e) => e.action === 'ORDER_EDITED_BY_CUSTOMER');
    expect(edit).toBeDefined();
    expect(edit!.actorType).toBe('CUSTOMER');
    expect(edit!.actorDeviceId).toBe(fx.deviceId);
  });

  it('does not extend the window when the guest edits', async () => {
    const { orderId, customerWindowExpiresAt } = await submit();
    await editOrderAsCustomer(db, {
      orderId,
      deviceId: fx.deviceId,
      lines: [{ menuItemId: fx.pho, quantity: 2 }],
      note: null,
    });

    // Otherwise a guest editing repeatedly could hold an order open forever and
    // the kitchen would never see it.
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.customerWindowExpiresAt!.getTime()).toBe(customerWindowExpiresAt!.getTime());
  });

  it('refuses a phone from another table', async () => {
    const { orderId } = await submit();
    await expect(
      editOrderAsCustomer(db, {
        orderId,
        deviceId: fx.otherDeviceId,
        lines: [{ menuItemId: fx.pho, quantity: 99 }],
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a caller with no device at all', async () => {
    const { orderId } = await submit();
    await expect(
      editOrderAsCustomer(db, {
        orderId,
        deviceId: null,
        lines: [{ menuItemId: fx.pho, quantity: 9 }],
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('sending the order', () => {
  it('sends it early when the guest asks, without waiting out the minute', async () => {
    const { orderId } = await submit();
    const result = await sendOrderNow(db, { orderId, deviceId: fx.deviceId });
    expect(result.alreadySent).toBe(false);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('CONFIRMED');
    expect(order!.confirmedBy, 'no member of staff confirmed it').toBeNull();
    expect(order!.confirmedAt).toBeInstanceOf(Date);
  });

  it('reaches the waiter as one settled order', async () => {
    const { orderId, orderNumber } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    const notes = await db.select().from(notifications).where(eq(notifications.orderId, orderId));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.status).toBe('PENDING');
    expect((notes[0]!.payload as any).orderNumber).toBe(orderNumber);
  });

  it('survives a double tap', async () => {
    const { orderId } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });
    const second = await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    expect(second.alreadySent).toBe(true);
    const notes = await db.select().from(notifications).where(eq(notifications.orderId, orderId));
    expect(notes, 'the kitchen must not be told twice').toHaveLength(1);
  });

  it('writes a final snapshot naming the system, not a waiter', async () => {
    const { orderId } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    const revisions = await db
      .select()
      .from(orderRevisions)
      .where(eq(orderRevisions.orderId, orderId))
      .orderBy(asc(orderRevisions.revisionNumber));

    const final = revisions.at(-1)!;
    expect(final.revisionType).toBe('FINAL_CONFIRMED');
    expect(final.actorType).toBe('SYSTEM');
    expect(final.actorUserId).toBeNull();
  });
});

describe('when the minute runs out', () => {
  it('confirms the order itself', async () => {
    const { orderId } = await submit();
    await expireWindow(orderId);

    const finalised = await finaliseExpiredOrders(db);
    expect(finalised).toEqual([orderId]);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('CONFIRMED');

    const events = await db.select().from(auditEvents).where(eq(auditEvents.orderId, orderId));
    const auto = events.find((e) => e.action === 'ORDER_AUTO_CONFIRMED');
    expect(auto!.actorType).toBe('SYSTEM');
    expect((auto!.metadata as any).trigger).toBe('waiter_screen');
  });

  it('leaves an order whose window is still open alone', async () => {
    const { orderId } = await submit();
    expect(await finaliseExpiredOrders(db)).toEqual([]);

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('AWAITING_CUSTOMER');
  });

  it('is safe to run twice', async () => {
    const { orderId } = await submit();
    await expireWindow(orderId);

    await finaliseExpiredOrders(db);
    expect(await finaliseExpiredOrders(db)).toEqual([]);

    const notes = await db.select().from(notifications).where(eq(notifications.orderId, orderId));
    expect(notes).toHaveLength(1);
  });

  it('turns a guest’s late edit away, and closes the order rather than stranding it', async () => {
    const { orderId } = await submit();
    await expireWindow(orderId);

    await expect(
      editOrderAsCustomer(db, {
        orderId,
        deviceId: fx.deviceId,
        lines: [{ menuItemId: fx.pho, quantity: 4 }],
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_WINDOW_CLOSED' });

    // The failed edit must not leave the order hanging in a window that has
    // already passed.
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('CONFIRMED');
    expect(order!.totalCents, 'the late change was not applied').toBe(2450);
  });

  it('refuses a guest edit once the order is confirmed', async () => {
    const { orderId } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    await expect(
      editOrderAsCustomer(db, {
        orderId,
        deviceId: fx.deviceId,
        lines: [{ menuItemId: fx.pho, quantity: 2 }],
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_WINDOW_CLOSED' });
  });

  it('moves the session on only when the order actually leaves the guest', async () => {
    const { orderId } = await submit();
    let [session] = await db
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, fx.sessionId));
    expect(session!.status).toBe('OCCUPIED');

    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    // Confirmed on arrival, so nothing is waiting on a waiter even now.
    [session] = await db.select().from(diningSessions).where(eq(diningSessions.id, fx.sessionId));
    expect(session!.status).toBe('OCCUPIED');
  });
});

describe('the emergency route once the window has closed', () => {
  it('lets a waiter reopen a confirmed order and confirm it again', async () => {
    const { orderId } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });

    await reopenOrder(db, {
      orderId,
      userId: fx.waiterId,
      reason: 'guest asked to remove a dish',
    });

    let [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('EMPLOYEE_REVIEW');

    await confirmOrder(db, { orderId, userId: fx.waiterId });
    [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('CONFIRMED');
    expect(order!.confirmedBy, 'this time a person did confirm it').toBe(fx.waiterId);
  });

  it('records who reopened it and why', async () => {
    const { orderId } = await submit();
    await sendOrderNow(db, { orderId, deviceId: fx.deviceId });
    await reopenOrder(db, { orderId, userId: fx.waiterId, reason: 'wrong table' });

    const events = await db.select().from(auditEvents).where(eq(auditEvents.orderId, orderId));
    const reopened = events.find((e) => e.action === 'ORDER_REOPENED');
    expect(reopened).toBeDefined();
    expect(reopened!.actorUserId).toBe(fx.waiterId);
    expect((reopened!.metadata as any).reason).toBe('wrong table');
  });

  it('lets a waiter take an order over while the guest still has it', async () => {
    const { orderId } = await submit();
    await confirmOrder(db, { orderId, userId: fx.waiterId });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order!.status).toBe('CONFIRMED');
    expect(order!.confirmedBy).toBe(fx.waiterId);

    // And the guest can no longer change what staff just agreed with them.
    await expect(
      editOrderAsCustomer(db, {
        orderId,
        deviceId: fx.deviceId,
        lines: [{ menuItemId: fx.pho, quantity: 7 }],
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_WINDOW_CLOSED' });
  });
});
