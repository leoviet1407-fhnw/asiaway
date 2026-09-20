import { createHash } from 'node:crypto';
import { and, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { domainError } from '../../domain/errors';
import {
  auditEventsForChanges,
  type Actor,
  type AuditEventInput,
} from '../../domain/audit/events';
import { validateCart, type CartLineRequest, type MenuItemRecord } from '../../domain/order/cart';
import { buildSnapshot, type OrderSnapshot } from '../../domain/order/snapshot';
import { planRevision } from '../../domain/order/revision';
import {
  transitionOrder,
  isOrderEditable,
  isCustomerEditable,
  type OrderStatus,
} from '../../domain/order/status';
import { transitionSession } from '../../domain/session/status';
import { activeGroupForTable } from './table-group-lookup';
import {
  auditEvents,
  customerDevices,
  diningSessions,
  idempotencyKeys,
  menuItems,
  notifications,
  orderItems,
  orderNotes,
  orderRevisions,
  orders,
} from '../db/schema';

/** Any Drizzle Postgres handle — a database or a transaction. */
export type Db = PgDatabase<any, any, any>;

export interface SubmitOrderInput {
  readonly sessionId: string;
  readonly deviceId: string | null;
  readonly lines: readonly CartLineRequest[];
  readonly note: string | null;
  readonly idempotencyKey: string;
}

export interface SubmitOrderResult {
  readonly orderId: string;
  readonly orderNumber: number;
  readonly totalCents: number;
  readonly submittedAt: Date;
  /** When the guest loses the ability to change this order themselves. */
  readonly customerWindowExpiresAt: Date | null;
  readonly replayed: boolean;
}

function hashRequest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

async function writeAuditEvents(tx: Db, events: readonly AuditEventInput[]): Promise<void> {
  if (events.length === 0) return;
  await tx.insert(auditEvents).values(
    events.map((e) => ({
      actorType: e.actor.type,
      actorUserId: e.actor.userId ?? null,
      actorDeviceId: e.actor.deviceId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      tableId: e.tableId ?? null,
      sessionId: e.sessionId ?? null,
      orderId: e.orderId ?? null,
      beforeValue: e.beforeValue ?? null,
      afterValue: e.afterValue ?? null,
      metadata: e.metadata ?? {},
    })),
  );
}

/** Reads the order's current state back as a snapshot for diffing. */
async function loadSnapshot(tx: Db, orderId: string): Promise<OrderSnapshot> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw domainError('ORDER_NOT_FOUND', 'Order not found', { orderId });

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const notes = await tx.select().from(orderNotes).where(eq(orderNotes.orderId, orderId));

  const latest = (source: 'CUSTOMER' | 'WAITER'): string | null =>
    notes
      .filter((n) => n.source === source)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .at(-1)?.noteText ?? null;

  return buildSnapshot({
    status: order.status,
    items: items
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map((i) => ({
        menuItemId: i.menuItemId,
        dishNumber: i.dishNumber,
        nameEn: i.nameEn,
        nameDe: i.nameDe,
        nameVi: i.nameVi,
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
        allergenCodes: i.allergenCodes,
      })),
    customerNote: latest('CUSTOMER'),
    waiterNote: latest('WAITER'),
  });
}

/**
 * Submits a customer order.
 *
 * Everything below happens in ONE transaction, so an order can never exist
 * without its revision 0, its audit event and its waiter notification — and
 * none of those can exist without the order.
 *
 * The client cannot influence the price: CartLineRequest carries no price field
 * and every unit price is read from menu_items inside this transaction.
 */
export async function submitOrder(db: Db, input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const requestHash = hashRequest({ lines: input.lines, note: input.note });

  return db.transaction(async (tx: Db) => {
    // --- idempotency: double taps, reloads and network retries -------------
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({
        key: input.idempotencyKey,
        scope: 'order.submit',
        sessionId: input.sessionId,
        requestHash,
        state: 'IN_PROGRESS',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length === 0) {
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, input.idempotencyKey));

      if (existing?.state === 'COMPLETED' && existing.responseBody) {
        const body = existing.responseBody as Omit<SubmitOrderResult, 'replayed'> & {
          submittedAt: string;
        };
        // Read the window from the order rather than the stored response: it
        // has been ticking down since, and a phone retrying a submit needs to
        // know how long is actually left, not how long there was at first.
        const [live] = await tx
          .select({ expiresAt: orders.customerWindowExpiresAt })
          .from(orders)
          .where(eq(orders.id, body.orderId));

        return {
          orderId: body.orderId,
          orderNumber: body.orderNumber,
          totalCents: body.totalCents,
          submittedAt: new Date(body.submittedAt),
          customerWindowExpiresAt: live?.expiresAt ?? null,
          replayed: true,
        };
      }
      throw domainError('REQUEST_IN_FLIGHT', 'An identical submission is already being processed');
    }

    // --- session must be open ---------------------------------------------
    const [session] = await tx
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, input.sessionId));

    if (!session) throw domainError('SESSION_NOT_FOUND', 'Dining session not found');
    if (session.status === 'CLOSED') {
      throw domainError('SESSION_CLOSED', 'This table session has been closed');
    }

    // --- server-side pricing and availability ------------------------------
    const requestedIds = [...new Set(input.lines.map((l) => l.menuItemId))];
    const records = requestedIds.length
      ? await tx.select().from(menuItems).where(inArray(menuItems.id, requestedIds))
      : [];

    const menuMap = new Map<string, MenuItemRecord>(
      records.map((r) => [
        r.id,
        {
          id: r.id,
          dishNumber: r.dishNumber,
          nameEn: r.nameEn,
          nameDe: r.nameDe,
          nameVi: r.nameVi,
          priceCents: r.priceCents,
          allergenCodes: r.allergenCodes,
          isAvailable: r.isAvailable,
          isActive: r.isActive,
        },
      ]),
    );

    const cart = validateCart(input.lines, menuMap, input.note);
    const snapshot = buildSnapshot({
      status: 'SUBMITTED',
      items: cart.items,
      customerNote: cart.note,
    });

    // --- persist -----------------------------------------------------------
    const [order] = await tx
      .insert(orders)
      .values({
        sessionId: session.id,
        tableId: session.primaryTableId,
        // The guest keeps this order for the next minute; the waiter cannot
        // see it yet.
        status: 'AWAITING_CUSTOMER',
        customerWindowExpiresAt: new Date(Date.now() + customerWindowSeconds() * 1000),
        submittedByDeviceId: input.deviceId,
        totalCents: snapshot.totalCents,
        currentRevisionNumber: 0,
      })
      .returning();

    if (!order) throw domainError('VALIDATION_FAILED', 'Order insert returned no row');

    await tx.insert(orderItems).values(
      snapshot.items.map((item, index) => ({
        orderId: order.id,
        menuItemId: item.menuItemId,
        dishNumber: item.dishNumber,
        nameEn: item.nameEn,
        nameDe: item.nameDe,
        nameVi: item.nameVi,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        lineTotalCents: item.lineTotalCents,
        allergenCodes: [...item.allergenCodes],
        sortIndex: index,
      })),
    );

    if (cart.note) {
      await tx.insert(orderNotes).values({
        orderId: order.id,
        noteText: cart.note,
        source: 'CUSTOMER',
      });
    }

    // Revision 0: the immutable original customer submission. Written here,
    // before any waiter can reach the order.
    await tx.insert(orderRevisions).values({
      orderId: order.id,
      revisionNumber: 0,
      revisionType: 'ORIGINAL_SUBMISSION',
      actorType: 'CUSTOMER',
      actorDeviceId: input.deviceId,
      beforeSnapshot: null,
      afterSnapshot: snapshot,
      totalCentsBefore: null,
      totalCentsAfter: snapshot.totalCents,
    });

    // The session stays as it is: nothing is waiting on a waiter until the
    // guest's window closes. resolveSessionStatus moves it then.
    await tx
      .update(diningSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(diningSessions.id, session.id));

    await writeAuditEvents(tx, [
      {
        action: 'ORDER_SUBMITTED',
        actor: { type: 'CUSTOMER', deviceId: input.deviceId },
        entityType: 'ORDER',
        entityId: order.id,
        tableId: session.primaryTableId,
        sessionId: session.id,
        orderId: order.id,
        beforeValue: null,
        afterValue: snapshot,
        metadata: { orderNumber: order.orderNumber, revisionNumber: 0 },
      },
    ]);

    // No notification yet. The waiter hears about this order when the guest's
    // window closes — see finaliseWithin. Notifying now would put an order the
    // guest is still changing into the waiter's queue, which is the traffic
    // this window exists to remove.

    const result = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalCents: snapshot.totalCents,
      submittedAt: order.submittedAt,
      customerWindowExpiresAt: order.customerWindowExpiresAt,
    };

    await tx
      .update(idempotencyKeys)
      .set({ state: 'COMPLETED', responseStatus: 201, responseBody: result })
      .where(eq(idempotencyKeys.key, input.idempotencyKey));

    if (input.deviceId) {
      await tx
        .update(customerDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(customerDevices.id, input.deviceId));
    }

    return { ...result, replayed: false };
  });
}

/**
 * Moves a session out of ORDER_PENDING once nothing is waiting on the waiter.
 *
 * Without this the dashboard would keep showing "order waiting" on a table whose
 * orders are all confirmed, and closing the session would be refused even though
 * there is nothing left to resolve. CHECKOUT_REQUESTED is preserved, because a
 * guest who asked for the bill must not stop looking like one.
 */
async function resolveSessionStatus(tx: Db, sessionId: string): Promise<void> {
  const [session] = await tx
    .select()
    .from(diningSessions)
    .where(eq(diningSessions.id, sessionId));
  if (!session || session.status === 'CLOSED') return;

  const remaining = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      sql`${orders.sessionId} = ${sessionId}
          and ${orders.status} in ('SUBMITTED', 'EMPLOYEE_REVIEW')`,
    );

  // Both directions. A session used to be pushed into ORDER_PENDING the moment
  // a guest submitted; orders now confirm themselves, so the only thing that
  // makes a session wait on staff is a waiter taking an order over — and that
  // has to move the session too, or the dashboard never shows it.
  const next =
    (remaining[0]?.n ?? 0) > 0
      ? transitionSession(session.status, 'ORDER_SUBMITTED')
      : transitionSession(session.status, 'ALL_ORDERS_RESOLVED');
  if (next !== session.status) {
    await tx.update(diningSessions).set({ status: next }).where(eq(diningSessions.id, sessionId));
  }
}

/** Waiter opens an order: SUBMITTED -> EMPLOYEE_REVIEW. Audited, no revision. */
export async function openOrderForReview(
  db: Db,
  input: { orderId: string; userId: string },
): Promise<void> {
  await db.transaction(async (tx: Db) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw domainError('ORDER_NOT_FOUND', 'Order not found', { orderId: input.orderId });

    const nextStatus = transitionOrder(order.status, 'OPEN_FOR_REVIEW');
    if (order.status === nextStatus) return; // already under review: no-op

    await tx
      .update(orders)
      .set({ status: nextStatus, openedByWaiterAt: new Date(), openedBy: input.userId })
      .where(eq(orders.id, order.id));

    await writeAuditEvents(tx, [
      {
        action: 'ORDER_OPENED_FOR_REVIEW',
        actor: { type: 'WAITER', userId: input.userId },
        entityType: 'ORDER',
        entityId: order.id,
        tableId: order.tableId,
        sessionId: order.sessionId,
        orderId: order.id,
        beforeValue: { status: order.status },
        afterValue: { status: nextStatus },
        metadata: { orderNumber: order.orderNumber },
      },
    ]);

    await resolveSessionStatus(tx, order.sessionId);
  });
}

export interface EditOrderInput {
  readonly orderId: string;
  readonly userId: string;
  readonly lines: readonly CartLineRequest[];
  readonly waiterNote?: string | null;
  readonly reason?: string | null;
  /** Optimistic concurrency: the revision the waiter's screen was showing. */
  readonly expectedRevisionNumber: number;
}

export interface EditOrderResult {
  readonly revisionNumber: number;
  readonly totalCents: number;
  readonly changed: boolean;
}

/**
 * Waiter edits a submitted order.
 *
 * The previous state is never overwritten in place: a new revision row carries
 * the complete before and after snapshots, and one audit event per individual
 * change records what moved. The original customer submission (revision 0) is
 * untouched by construction — nothing here writes to it.
 */
export async function editOrder(db: Db, input: EditOrderInput): Promise<EditOrderResult> {
  return db.transaction(async (tx: Db) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw domainError('ORDER_NOT_FOUND', 'Order not found', { orderId: input.orderId });

    if (!isOrderEditable(order.status)) {
      throw domainError('ORDER_NOT_EDITABLE', `An order in status ${order.status} cannot be edited`, {
        status: order.status,
      });
    }

    if (order.currentRevisionNumber !== input.expectedRevisionNumber) {
      throw domainError('REVISION_CONFLICT', 'This order was changed on another device', {
        expected: input.expectedRevisionNumber,
        actual: order.currentRevisionNumber,
      });
    }

    const before = await loadSnapshot(tx, order.id);

    const requestedIds = [...new Set(input.lines.map((l) => l.menuItemId))];
    const records = requestedIds.length
      ? await tx.select().from(menuItems).where(inArray(menuItems.id, requestedIds))
      : [];

    // A waiter standing at the table may legitimately add an item the guest
    // could not order themselves, so availability is not enforced here — but
    // the price still comes from the database, never from the client.
    const menuMap = new Map<string, MenuItemRecord>(
      records.map((r) => [
        r.id,
        {
          id: r.id,
          dishNumber: r.dishNumber,
          nameEn: r.nameEn,
          nameDe: r.nameDe,
          nameVi: r.nameVi,
          priceCents: r.priceCents,
          allergenCodes: r.allergenCodes,
          isAvailable: true,
          isActive: r.isActive,
        },
      ]),
    );

    const cart = validateCart(input.lines, menuMap, before.customerNote);
    const waiterNote =
      input.waiterNote === undefined ? before.waiterNote : (input.waiterNote?.trim() || null);

    const after = buildSnapshot({
      status: order.status,
      items: cart.items,
      customerNote: before.customerNote,
      waiterNote,
    });

    const plan = planRevision(before, after, 'WAITER_EDIT');
    if (!plan.shouldCreateRevision) {
      return { revisionNumber: order.currentRevisionNumber, totalCents: before.totalCents, changed: false };
    }

    const revisionNumber = order.currentRevisionNumber + 1;

    await tx.delete(orderItems).where(eq(orderItems.orderId, order.id));
    await tx.insert(orderItems).values(
      after.items.map((item, index) => ({
        orderId: order.id,
        menuItemId: item.menuItemId,
        dishNumber: item.dishNumber,
        nameEn: item.nameEn,
        nameDe: item.nameDe,
        nameVi: item.nameVi,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        lineTotalCents: item.lineTotalCents,
        allergenCodes: [...item.allergenCodes],
        sortIndex: index,
      })),
    );

    if (waiterNote !== before.waiterNote && waiterNote !== null) {
      await tx.insert(orderNotes).values({
        orderId: order.id,
        noteText: waiterNote,
        source: 'WAITER',
        createdBy: input.userId,
      });
    }

    await tx.insert(orderRevisions).values({
      orderId: order.id,
      revisionNumber,
      revisionType: 'WAITER_EDIT',
      actorType: 'WAITER',
      actorUserId: input.userId,
      reason: input.reason ?? null,
      beforeSnapshot: before,
      afterSnapshot: after,
      totalCentsBefore: before.totalCents,
      totalCentsAfter: after.totalCents,
    });

    await tx
      .update(orders)
      .set({ totalCents: after.totalCents, currentRevisionNumber: revisionNumber })
      .where(eq(orders.id, order.id));

    await writeAuditEvents(
      tx,
      auditEventsForChanges(plan.materialChanges, {
        actor: { type: 'WAITER', userId: input.userId },
        orderId: order.id,
        sessionId: order.sessionId,
        tableId: order.tableId,
        revisionNumber,
        reason: input.reason ?? null,
      }),
    );

    return { revisionNumber, totalCents: after.totalCents, changed: true };
  });
}

/**
 * Waiter confirms the order after checking it at the table.
 *
 * Writes a FINAL_CONFIRMED revision so "what was agreed and keyed into the POS"
 * is a single row, distinct from the working head, and acknowledges the
 * order's notification so it leaves the pending queue on every device at once.
 */
/**
 * How long the guest keeps control of an order they have just sent.
 *
 * Long enough to notice "I meant two, not one" and fix it; short enough that
 * the kitchen is not kept waiting. The restaurant asked for 60 seconds.
 */
export function customerWindowSeconds(): number {
  const raw = Number(process.env.CUSTOMER_EDIT_WINDOW_SECONDS ?? 60);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60;
}

function windowHasExpired(order: { customerWindowExpiresAt: Date | null }, now = new Date()): boolean {
  return !order.customerWindowExpiresAt || order.customerWindowExpiresAt.getTime() <= now.getTime();
}

/**
 * Closes a guest's window: the order confirms itself and only now becomes
 * visible to the waiter.
 *
 * Idempotent, because three things race to call it — the guest's countdown, the
 * guest pressing send, and any waiter screen that happens to load. An order
 * already past the window simply reports back what it is.
 */
async function finaliseWithin(
  tx: Db,
  orderId: string,
  trigger: 'timer' | 'sent_by_guest' | 'waiter_screen',
): Promise<{ finalised: boolean; orderNumber: number; sessionId: string } | null> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  if (order.status !== 'AWAITING_CUSTOMER') {
    return { finalised: false, orderNumber: order.orderNumber, sessionId: order.sessionId };
  }

  const status = transitionOrder(order.status, 'FINALISE');
  const before = await loadSnapshot(tx, order.id);
  const after = buildSnapshot({
    status,
    items: before.items.map((i) => ({
      menuItemId: i.menuItemId,
      dishNumber: i.dishNumber,
      nameEn: i.nameEn,
      nameDe: i.nameDe,
      nameVi: i.nameVi,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      allergenCodes: i.allergenCodes,
    })),
    customerNote: before.customerNote,
    waiterNote: before.waiterNote,
  });

  const revisionNumber = order.currentRevisionNumber + 1;
  const confirmedAt = new Date();

  await tx.insert(orderRevisions).values({
    orderId: order.id,
    revisionNumber,
    revisionType: 'FINAL_CONFIRMED',
    // Nobody on staff confirmed this: the system did, when the guest's window
    // ran out. Attributing it to a waiter would put a name against a decision
    // no person made.
    actorType: 'SYSTEM',
    reason: trigger === 'sent_by_guest' ? 'guest sent the order early' : 'edit window closed',
    beforeSnapshot: before,
    afterSnapshot: after,
    totalCentsBefore: before.totalCents,
    totalCentsAfter: after.totalCents,
  });

  await tx
    .update(orders)
    .set({
      status,
      confirmedAt,
      confirmedBy: null,
      currentRevisionNumber: revisionNumber,
      totalCents: after.totalCents,
    })
    .where(eq(orders.id, order.id));

  await writeAuditEvents(tx, [
    {
      action: 'ORDER_AUTO_CONFIRMED',
      actor: { type: 'SYSTEM' },
      entityType: 'ORDER',
      entityId: order.id,
      tableId: order.tableId,
      sessionId: order.sessionId,
      orderId: order.id,
      beforeValue: { status: 'AWAITING_CUSTOMER', totalCents: before.totalCents },
      afterValue: { status, totalCents: after.totalCents },
      metadata: { orderNumber: order.orderNumber, revisionNumber, trigger },
    },
  ]);

  // The waiter hears about the order now, and only now — one settled order
  // rather than a submission followed by corrections.
  await tx.insert(notifications).values({
    type: 'NEW_ORDER',
    status: 'PENDING',
    sessionId: order.sessionId,
    orderId: order.id,
    tableId: order.tableId,
    payload: {
      orderNumber: order.orderNumber,
      totalCents: after.totalCents,
      itemCount: after.items.reduce((n, i) => n + i.quantity, 0),
      autoConfirmed: true,
    },
  });

  await resolveSessionStatus(tx, order.sessionId);

  return { finalised: true, orderNumber: order.orderNumber, sessionId: order.sessionId };
}

/**
 * Closes any window that has run out.
 *
 * Called on the waiter's own screen reads rather than from a scheduled job. A
 * guest who closes their phone the second after ordering still has a working
 * countdown on the server, but nothing in a serverless deployment would run it;
 * the waiter's dashboard polls every few seconds anyway, so the order surfaces
 * there. This is the same reasoning as expiring a stale session at scan time.
 */
export async function finaliseExpiredOrders(db: Db): Promise<string[]> {
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'AWAITING_CUSTOMER'),
        lte(orders.customerWindowExpiresAt, new Date()),
      ),
    );
  if (due.length === 0) return [];

  const finalised: string[] = [];
  for (const row of due) {
    // One transaction each: a single order that fails to finalise must not
    // hold back every other table's orders.
    const result = await db.transaction((tx: Db) => finaliseWithin(tx, row.id, 'waiter_screen'));
    if (result?.finalised) finalised.push(row.id);
  }
  return finalised;
}

/**
 * Closes every open window belonging to one session, inside a caller's
 * transaction.
 *
 * Used when the bill is settled. A guest paying has finished ordering, so an
 * order still inside its window is final — and leaving it open would strand it
 * on a closed session, to surface later as a notification for a table that has
 * already been cleared.
 */
export async function finaliseOpenWindowsForSession(
  tx: Db,
  sessionId: string,
): Promise<number[]> {
  const open = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.sessionId, sessionId), eq(orders.status, 'AWAITING_CUSTOMER')));

  const numbers: number[] = [];
  for (const row of open) {
    const result = await finaliseWithin(tx, row.id, 'timer');
    if (result?.finalised) numbers.push(result.orderNumber);
  }
  return numbers;
}

/** The guest pressing "send to the kitchen" before their window runs out. */
export async function sendOrderNow(
  db: Db,
  input: { orderId: string; deviceId: string | null },
): Promise<{ orderNumber: number; alreadySent: boolean }> {
  return db.transaction(async (tx: Db) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw domainError('ORDER_NOT_FOUND', 'Order not found');
    await assertOrderBelongsToDevice(tx, order, input.deviceId);

    if (order.status !== 'AWAITING_CUSTOMER') {
      return { orderNumber: order.orderNumber, alreadySent: true };
    }
    const result = await finaliseWithin(tx, order.id, 'sent_by_guest');
    return { orderNumber: order.orderNumber, alreadySent: !result?.finalised };
  });
}

/**
 * An order may only be changed from the device that placed it, and only while
 * it belongs to the session that device is sitting in. Without this, anyone who
 * learned an order id could edit a stranger's food.
 */
async function assertOrderBelongsToDevice(
  tx: Db,
  order: { id: string; sessionId: string; submittedByDeviceId: string | null },
  deviceId: string | null,
): Promise<void> {
  if (!deviceId) throw domainError('FORBIDDEN', 'This order cannot be changed from here');

  const [device] = await tx
    .select()
    .from(customerDevices)
    .where(eq(customerDevices.id, deviceId));

  // Same table, same visit. Phones at one table share a session deliberately,
  // so a couple can fix each other's order; a phone from another table cannot.
  if (!device || device.sessionId !== order.sessionId) {
    throw domainError('FORBIDDEN', 'This order cannot be changed from here');
  }
}

/**
 * The guest changing their own order inside the window.
 *
 * Written as a revision, never over the top of the original. With no waiter
 * reviewing the order any more, this trail is the only record of what the guest
 * actually asked for and when they changed their mind.
 */
export async function editOrderAsCustomer(
  db: Db,
  input: {
    orderId: string;
    deviceId: string | null;
    lines: CartLineRequest[];
    note: string | null;
  },
): Promise<{ orderNumber: number; totalCents: number; revisionNumber: number; secondsLeft: number }> {
  // The "window has closed" case reports back rather than throwing from inside
  // the transaction: it finalises the order, and a throw would roll that back
  // along with it, leaving the order stranded in a window that has passed.
  const outcome = await db.transaction(async (tx: Db) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw domainError('ORDER_NOT_FOUND', 'Order not found');
    await assertOrderBelongsToDevice(tx, order, input.deviceId);

    if (!isCustomerEditable(order.status)) return { closed: true } as const;

    if (windowHasExpired(order)) {
      // The timer ran out while they were editing. Close the order properly
      // instead of leaving it behind, then tell them to ask staff.
      await finaliseWithin(tx, order.id, 'timer');
      return { closed: true } as const;
    }

    const requestedIds = [...new Set(input.lines.map((l) => l.menuItemId))];
    const records = requestedIds.length
      ? await tx.select().from(menuItems).where(inArray(menuItems.id, requestedIds))
      : [];
    const menuMap = new Map<string, MenuItemRecord>(
      records.map((r) => [
        r.id,
        {
          id: r.id,
          dishNumber: r.dishNumber,
          nameEn: r.nameEn,
          nameDe: r.nameDe,
          nameVi: r.nameVi,
          priceCents: r.priceCents,
          allergenCodes: r.allergenCodes,
          isAvailable: r.isAvailable,
          isActive: r.isActive,
        },
      ]),
    );

    const cart = validateCart(input.lines, menuMap, input.note);
    const before = await loadSnapshot(tx, order.id);
    const after = buildSnapshot({
      status: order.status,
      items: cart.items,
      customerNote: cart.note,
      waiterNote: before.waiterNote,
    });

    const revisionNumber = order.currentRevisionNumber + 1;

    await tx.insert(orderRevisions).values({
      orderId: order.id,
      revisionNumber,
      revisionType: 'CUSTOMER_EDIT',
      actorType: 'CUSTOMER',
      actorDeviceId: input.deviceId,
      reason: 'changed by the guest inside the edit window',
      beforeSnapshot: before,
      afterSnapshot: after,
      totalCentsBefore: before.totalCents,
      totalCentsAfter: after.totalCents,
    });

    await tx.delete(orderItems).where(eq(orderItems.orderId, order.id));
    await tx.insert(orderItems).values(
      after.items.map((item, index) => ({
        orderId: order.id,
        menuItemId: item.menuItemId,
        dishNumber: item.dishNumber,
        nameEn: item.nameEn,
        nameDe: item.nameDe,
        nameVi: item.nameVi,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        lineTotalCents: item.lineTotalCents,
        allergenCodes: [...item.allergenCodes],
        sortIndex: index,
      })),
    );

    await tx.delete(orderNotes).where(
      and(eq(orderNotes.orderId, order.id), eq(orderNotes.source, 'CUSTOMER')),
    );
    if (cart.note) {
      await tx
        .insert(orderNotes)
        .values({ orderId: order.id, noteText: cart.note, source: 'CUSTOMER' });
    }

    await tx
      .update(orders)
      .set({ currentRevisionNumber: revisionNumber, totalCents: after.totalCents })
      .where(eq(orders.id, order.id));

    await writeAuditEvents(tx, [
      {
        action: 'ORDER_EDITED_BY_CUSTOMER',
        actor: { type: 'CUSTOMER', deviceId: input.deviceId },
        entityType: 'ORDER',
        entityId: order.id,
        tableId: order.tableId,
        sessionId: order.sessionId,
        orderId: order.id,
        beforeValue: before,
        afterValue: after,
        metadata: { orderNumber: order.orderNumber, revisionNumber },
      },
    ]);

    // The window is NOT extended. Otherwise a guest editing repeatedly could
    // hold an order open indefinitely and the kitchen would never see it.
    const secondsLeft = Math.max(
      0,
      Math.ceil(((order.customerWindowExpiresAt?.getTime() ?? 0) - Date.now()) / 1000),
    );

    return {
      closed: false as const,
      orderNumber: order.orderNumber,
      totalCents: after.totalCents,
      revisionNumber,
      secondsLeft,
    };
  });

  if (outcome.closed) {
    throw domainError(
      'ORDER_WINDOW_CLOSED',
      'This order has already gone to the kitchen. Please ask a member of staff.',
    );
  }

  return outcome;
}

/**
 * A waiter reopening a confirmed order because the guest asked them to.
 *
 * With the confirm step gone, this is the emergency route the restaurant asked
 * for: once the window closes the guest cannot change anything themselves, so
 * they call someone over. Reopening is recorded, because an order that changes
 * after the kitchen has seen it is exactly what an audit trail is for.
 */
export async function reopenOrder(
  db: Db,
  input: { orderId: string; userId: string; reason: string | null },
): Promise<{ orderNumber: number; status: OrderStatus }> {
  return db.transaction(async (tx: Db) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw domainError('ORDER_NOT_FOUND', 'Order not found');

    const status = transitionOrder(order.status, 'REOPEN');

    await tx
      .update(orders)
      .set({ status, openedByWaiterAt: new Date(), openedBy: input.userId })
      .where(eq(orders.id, order.id));

    await writeAuditEvents(tx, [
      {
        action: 'ORDER_REOPENED',
        actor: { type: 'WAITER', userId: input.userId },
        entityType: 'ORDER',
        entityId: order.id,
        tableId: order.tableId,
        sessionId: order.sessionId,
        orderId: order.id,
        beforeValue: { status: order.status },
        afterValue: { status },
        metadata: { orderNumber: order.orderNumber, reason: input.reason },
      },
    ]);

    await resolveSessionStatus(tx, order.sessionId);

    return { orderNumber: order.orderNumber, status };
  });
}

export async function confirmOrder(
  db: Db,
  input: { orderId: string; userId: string },
): Promise<{ orderNumber: number; revisionNumber: number; totalCents: number }> {
  return db.transaction(async (tx: Db) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw domainError('ORDER_NOT_FOUND', 'Order not found', { orderId: input.orderId });

    // Confirming without an explicit open is allowed, but both transitions are
    // recorded so the audit trail always shows the review step.
    //
    // AWAITING_CUSTOMER counts here too: a waiter called over mid-window takes
    // the order out of the guest's hands, and the guest's next edit is then
    // refused rather than silently overwriting what staff just agreed.
    let status = order.status;
    if (status === 'SUBMITTED' || status === 'AWAITING_CUSTOMER') {
      status = transitionOrder(status, 'OPEN_FOR_REVIEW');
      await tx
        .update(orders)
        .set({ status, openedByWaiterAt: new Date(), openedBy: input.userId })
        .where(eq(orders.id, order.id));
      await writeAuditEvents(tx, [
        {
          action: 'ORDER_OPENED_FOR_REVIEW',
          actor: { type: 'WAITER', userId: input.userId },
          entityType: 'ORDER',
          entityId: order.id,
          tableId: order.tableId,
          sessionId: order.sessionId,
          orderId: order.id,
          beforeValue: { status: order.status },
          afterValue: { status },
          metadata: { orderNumber: order.orderNumber, implicit: true },
        },
      ]);
    }

    const confirmedStatus = transitionOrder(status, 'CONFIRM');
    const before = await loadSnapshot(tx, order.id);
    const after = buildSnapshot({
      status: confirmedStatus,
      items: before.items.map((i) => ({
        menuItemId: i.menuItemId,
        dishNumber: i.dishNumber,
        nameEn: i.nameEn,
        nameDe: i.nameDe,
        nameVi: i.nameVi,
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
        allergenCodes: i.allergenCodes,
      })),
      customerNote: before.customerNote,
      waiterNote: before.waiterNote,
    });

    const revisionNumber = order.currentRevisionNumber + 1;
    const confirmedAt = new Date();

    await tx.insert(orderRevisions).values({
      orderId: order.id,
      revisionNumber,
      revisionType: 'FINAL_CONFIRMED',
      actorType: 'WAITER',
      actorUserId: input.userId,
      beforeSnapshot: before,
      afterSnapshot: after,
      totalCentsBefore: before.totalCents,
      totalCentsAfter: after.totalCents,
    });

    await tx
      .update(orders)
      .set({
        status: confirmedStatus,
        confirmedAt,
        confirmedBy: input.userId,
        currentRevisionNumber: revisionNumber,
        totalCents: after.totalCents,
      })
      .where(eq(orders.id, order.id));

    await writeAuditEvents(tx, [
      {
        action: 'ORDER_CONFIRMED',
        actor: { type: 'WAITER', userId: input.userId },
        entityType: 'ORDER',
        entityId: order.id,
        tableId: order.tableId,
        sessionId: order.sessionId,
        orderId: order.id,
        beforeValue: { status, totalCents: before.totalCents },
        afterValue: { status: confirmedStatus, totalCents: after.totalCents },
        metadata: { orderNumber: order.orderNumber, revisionNumber },
      },
    ]);

    await tx
      .update(notifications)
      .set({ status: 'ACKNOWLEDGED', acknowledgedAt: confirmedAt, acknowledgedBy: input.userId })
      .where(and(eq(notifications.orderId, order.id), eq(notifications.status, 'PENDING')));

    await resolveSessionStatus(tx, order.sessionId);

    return { orderNumber: order.orderNumber, revisionNumber, totalCents: after.totalCents };
  });
}

/** Full history for one order: revision 0 first, final confirmed last. */
export async function getOrderHistory(db: Db, orderId: string) {
  return db
    .select()
    .from(orderRevisions)
    .where(eq(orderRevisions.orderId, orderId))
    .orderBy(orderRevisions.revisionNumber);
}

export interface CreateOrderForTableInput {
  readonly tableId: string;
  readonly userId: string;
  readonly lines: readonly CartLineRequest[];
  readonly note: string | null;
  readonly idempotencyKey: string;
}

/**
 * An order taken by a waiter at the table, for guests who are not ordering from
 * their own phone.
 *
 * It goes straight to CONFIRMED. The review step exists so that a waiter checks
 * what a guest sent from their phone; here the waiter IS the one taking it, and
 * making them confirm their own typing at the table would be theatre. The audit
 * trail still records both steps, so a confirmed order always has the same
 * shape however it arrived.
 *
 * Attribution is honest throughout: actor WAITER rather than CUSTOMER, no
 * device id, and the waiter's user id on the order, the revisions and every
 * audit event. Nothing here pretends a guest pressed a button.
 *
 * Availability is deliberately NOT enforced, matching waiter edits: staff at
 * the table know what the kitchen actually has.
 */
export async function createOrderForTable(
  db: Db,
  input: CreateOrderForTableInput,
): Promise<{ orderId: string; orderNumber: number; totalCents: number; replayed: boolean }> {
  const requestHash = hashRequest({ lines: input.lines, note: input.note, table: input.tableId });

  return db.transaction(async (tx: Db) => {
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({
        key: input.idempotencyKey,
        scope: 'waiter.order.create',
        requestHash,
        state: 'IN_PROGRESS',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length === 0) {
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, input.idempotencyKey));
      if (existing?.state === 'COMPLETED' && existing.responseBody) {
        const body = existing.responseBody as {
          orderId: string;
          orderNumber: number;
          totalCents: number;
        };
        return { ...body, replayed: true };
      }
      throw domainError('REQUEST_IN_FLIGHT', 'This order is already being created');
    }

    // Tables pushed together share one bill, so the order belongs to the
    // group's anchor — exactly as it would if the guests had scanned a QR code
    // at any of those tables. Without this, tapping a member table on the floor
    // plan would open a second session and split the party's bill in two.
    const group = await activeGroupForTable(tx, input.tableId);
    const sessionTableId = group?.anchorTableId ?? input.tableId;

    // Find that table's open session, or open one. A party seated and ordering
    // through a waiter still gets a session, so their bill accumulates exactly
    // as it would if they had scanned.
    const [openSession] = await tx
      .select()
      .from(diningSessions)
      .where(and(eq(diningSessions.primaryTableId, sessionTableId), ne(diningSessions.status, 'CLOSED')));

    let session = openSession;
    if (!session) {
      const [created] = await tx
        .insert(diningSessions)
        .values({
          primaryTableId: sessionTableId,
          // Carrying the group means closing this bill separates the tables
          // again, the same as for a session opened by a scan.
          tableGroupId: group?.groupId ?? null,
          status: 'OCCUPIED',
        })
        .returning();
      session = created!;
      await tx.insert(auditEvents).values({
        actorType: 'WAITER',
        actorUserId: input.userId,
        action: 'SESSION_OPENED',
        entityType: 'SESSION',
        entityId: session.id,
        tableId: sessionTableId,
        sessionId: session.id,
        afterValue: { status: 'OCCUPIED' },
        metadata: {
          openedByStaff: true,
          reason: 'waiter took an order at the table',
          ...(group
            ? { combined: true, tappedTable: input.tableId, joinedTables: group.memberTableNumbers }
            : {}),
        },
      });
    } else if (group && !session.tableGroupId) {
      // The session was opened before the tables were pushed together.
      await tx
        .update(diningSessions)
        .set({ tableGroupId: group.groupId })
        .where(eq(diningSessions.id, session.id));
      session = { ...session, tableGroupId: group.groupId };
    }

    const requestedIds = [...new Set(input.lines.map((l) => l.menuItemId))];
    const records = requestedIds.length
      ? await tx.select().from(menuItems).where(inArray(menuItems.id, requestedIds))
      : [];

    const menuMap = new Map<string, MenuItemRecord>(
      records.map((r) => [
        r.id,
        {
          id: r.id,
          dishNumber: r.dishNumber,
          nameEn: r.nameEn,
          nameDe: r.nameDe,
          nameVi: r.nameVi,
          priceCents: r.priceCents,
          allergenCodes: r.allergenCodes,
          isAvailable: true, // staff override; see the note above
          isActive: r.isActive,
        },
      ]),
    );

    const cart = validateCart(input.lines, menuMap, input.note);
    const submitted = buildSnapshot({ status: 'SUBMITTED', items: cart.items, customerNote: cart.note });
    const now = new Date();

    const [order] = await tx
      .insert(orders)
      .values({
        sessionId: session.id,
        tableId: input.tableId,
        status: 'CONFIRMED',
        submittedByDeviceId: null,
        openedByWaiterAt: now,
        openedBy: input.userId,
        confirmedAt: now,
        confirmedBy: input.userId,
        totalCents: submitted.totalCents,
        currentRevisionNumber: 1,
      })
      .returning();

    await tx.insert(orderItems).values(
      submitted.items.map((item, index) => ({
        orderId: order!.id,
        menuItemId: item.menuItemId,
        dishNumber: item.dishNumber,
        nameEn: item.nameEn,
        nameDe: item.nameDe,
        nameVi: item.nameVi,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        lineTotalCents: item.lineTotalCents,
        allergenCodes: [...item.allergenCodes],
        sortIndex: index,
      })),
    );

    if (cart.note) {
      await tx.insert(orderNotes).values({
        orderId: order!.id,
        noteText: cart.note,
        source: 'CUSTOMER', // the guest's request, written down by the waiter
        createdBy: input.userId,
      });
    }

    const confirmed = buildSnapshot({
      status: 'CONFIRMED',
      items: cart.items,
      customerNote: cart.note,
    });

    await tx.insert(orderRevisions).values([
      {
        orderId: order!.id,
        revisionNumber: 0,
        revisionType: 'ORIGINAL_SUBMISSION',
        actorType: 'WAITER',
        actorUserId: input.userId,
        reason: 'taken at the table by staff',
        beforeSnapshot: null,
        afterSnapshot: submitted,
        totalCentsBefore: null,
        totalCentsAfter: submitted.totalCents,
      },
      {
        orderId: order!.id,
        revisionNumber: 1,
        revisionType: 'FINAL_CONFIRMED',
        actorType: 'WAITER',
        actorUserId: input.userId,
        beforeSnapshot: submitted,
        afterSnapshot: confirmed,
        totalCentsBefore: submitted.totalCents,
        totalCentsAfter: confirmed.totalCents,
      },
    ]);

    await tx
      .update(diningSessions)
      .set({ lastActivityAt: now })
      .where(eq(diningSessions.id, session.id));

    await writeAuditEvents(tx, [
      {
        action: 'ORDER_SUBMITTED',
        actor: { type: 'WAITER', userId: input.userId },
        entityType: 'ORDER',
        entityId: order!.id,
        tableId: input.tableId,
        sessionId: session.id,
        orderId: order!.id,
        beforeValue: null,
        afterValue: submitted,
        metadata: { orderNumber: order!.orderNumber, takenByStaff: true },
      },
      {
        action: 'ORDER_CONFIRMED',
        actor: { type: 'WAITER', userId: input.userId },
        entityType: 'ORDER',
        entityId: order!.id,
        tableId: input.tableId,
        sessionId: session.id,
        orderId: order!.id,
        beforeValue: { status: 'SUBMITTED' },
        afterValue: { status: 'CONFIRMED', totalCents: confirmed.totalCents },
        metadata: { orderNumber: order!.orderNumber, takenByStaff: true },
      },
    ]);

    const result = {
      orderId: order!.id,
      orderNumber: order!.orderNumber,
      totalCents: confirmed.totalCents,
    };

    await tx
      .update(idempotencyKeys)
      .set({ state: 'COMPLETED', responseStatus: 201, responseBody: result })
      .where(eq(idempotencyKeys.key, input.idempotencyKey));

    return { ...result, replayed: false };
  });
}
