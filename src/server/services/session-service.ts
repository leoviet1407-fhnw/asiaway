import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { transitionSession } from '../../domain/session/status';
import {
  resolveAnchorTable,
  resolveScanTarget,
  type TableGroupPolicy,
  type TableRef,
} from '../../domain/session/table-group';
import { isWellFormedQrToken } from '../../domain/session/qr-token';
import { isConnectedSelection } from '../../config/floor-plan';
import { sha256 } from '../auth/session';
import {
  auditEvents,
  customerDevices,
  diningSessions,
  notifications,
  orders,
  restaurantTables,
  tableGroupMembers,
  tableGroups,
} from '../db/schema';
import { finaliseOpenWindowsForSession } from './order-service';
import type { Db } from './order-service';

/** Hours a session may sit untouched before it is considered abandoned. */
export function idleTimeoutHours(): number {
  const raw = Number(process.env.SESSION_IDLE_TIMEOUT_HOURS ?? 4);
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
}

export function isSessionStale(lastActivityAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastActivityAt.getTime() > idleTimeoutHours() * 3600_000;
}

export interface ScanResult {
  readonly sessionId: string;
  readonly tableId: string;
  readonly tableNumber: string;
  readonly tableLabel: string;
  readonly deviceId: string;
  readonly deviceToken: string;
  readonly isNewSession: boolean;
  readonly isCombined: boolean;
  /** The table the guest is physically sitting at, if different from the anchor. */
  readonly scannedTableNumber: string;
}

/**
 * Resolves a scanned QR token to a dining session, creating one if the table is
 * free.
 *
 * Combined tables (decision E4): the lowest-numbered joined table anchors the
 * session, and scanning any member's QR reaches it, so a guest at the far end of
 * a joined row never has to hunt for the "right" code.
 */
export async function resolveScan(
  db: Db,
  input: { qrToken: string; existingDeviceToken?: string | null; userAgentHash?: string | null },
): Promise<ScanResult> {
  if (!isWellFormedQrToken(input.qrToken)) {
    throw domainError('QR_INVALID', 'This QR code is not valid');
  }

  return db.transaction(async (tx: Db) => {
    const [scanned] = await tx
      .select()
      .from(restaurantTables)
      .where(and(eq(restaurantTables.qrToken, input.qrToken), eq(restaurantTables.isActive, true)));

    if (!scanned) {
      // Deliberately says nothing about which tables exist.
      throw domainError('QR_INVALID', 'This QR code is not valid');
    }

    // Is this table currently part of an active combined group?
    const groupRows = await tx
      .select({
        groupId: tableGroups.id,
        policy: tableGroups.qrPolicy,
        memberId: restaurantTables.id,
        memberNumber: restaurantTables.tableNumber,
      })
      .from(tableGroupMembers)
      .innerJoin(tableGroups, eq(tableGroups.id, tableGroupMembers.tableGroupId))
      .innerJoin(restaurantTables, eq(restaurantTables.id, tableGroupMembers.tableId))
      .where(
        sql`${tableGroups.status} = 'ACTIVE' and ${tableGroupMembers.leftAt} is null
            and ${tableGroups.id} = (
              select tgm.table_group_id from table_group_members tgm
              join table_groups tg on tg.id = tgm.table_group_id
              where tgm.table_id = ${scanned.id} and tgm.left_at is null and tg.status = 'ACTIVE'
              limit 1
            )`,
      );

    const members: TableRef[] = groupRows.map((r) => ({ id: r.memberId, tableNumber: r.memberNumber }));
    const policy = (groupRows[0]?.policy ?? 'ANY_MEMBER') as TableGroupPolicy;
    const groupId = groupRows[0]?.groupId ?? null;

    const target = resolveScanTarget(
      { id: scanned.id, tableNumber: scanned.tableNumber },
      members.length > 0 ? members : null,
      policy,
    );

    const [anchorTable] = await tx
      .select()
      .from(restaurantTables)
      .where(eq(restaurantTables.id, target.anchorTable.id));
    if (!anchorTable) throw domainError('QR_INVALID', 'This QR code is not valid');

    // One open session per table is a database guarantee (partial unique index),
    // so this read-then-create is safe: a losing race hits the constraint.
    const [openSession] = await tx
      .select()
      .from(diningSessions)
      .where(
        and(eq(diningSessions.primaryTableId, anchorTable.id), ne(diningSessions.status, 'CLOSED')),
      );

    let session = openSession;
    let isNewSession = false;

    // A party that left without asking for the bill leaves its session open. If
    // the next guests scan that table, they would inherit the previous party's
    // orders and their bill — the worst failure this system can have.
    //
    // Checking here, at the scan, rather than only on a timer is what actually
    // closes the hole: a sweep every hour still misses a table that turns over
    // ten minutes after it ran, and this is the exact moment the harm would
    // occur. The scheduled sweep remains useful only for tidying tables nobody
    // scans again.
    if (session && isSessionStale(session.lastActivityAt)) {
      const closedAt = new Date();
      await tx
        .update(diningSessions)
        .set({
          status: 'CLOSED',
          closedAt,
          closeReason: `auto-closed on re-scan after ${idleTimeoutHours()}h idle`,
        })
        .where(eq(diningSessions.id, session.id));

      await tx.insert(auditEvents).values({
        actorType: 'SYSTEM',
        action: 'SESSION_CLOSED',
        entityType: 'SESSION',
        entityId: session.id,
        tableId: anchorTable.id,
        sessionId: session.id,
        beforeValue: { status: session.status },
        afterValue: { status: 'CLOSED' },
        metadata: { auto: true, trigger: 'scan', idleHours: idleTimeoutHours() },
      });

      if (session.tableGroupId) {
        await dissolveGroup(
          tx,
          session.tableGroupId,
          {
            userId: null,
            auto: true,
            reason: 'abandoned session closed on re-scan',
            sessionId: session.id,
          },
          { clearSessionLinks: false },
        );
      }

      // Fall through and open a clean session for the new guests.
      session = undefined;
    }

    if (!session) {
      const [created] = await tx
        .insert(diningSessions)
        .values({
          primaryTableId: anchorTable.id,
          tableGroupId: groupId,
          status: 'OCCUPIED',
        })
        .returning();
      session = created!;
      isNewSession = true;

      await tx.insert(auditEvents).values({
        actorType: 'CUSTOMER',
        action: 'SESSION_OPENED',
        entityType: 'SESSION',
        entityId: session.id,
        tableId: anchorTable.id,
        sessionId: session.id,
        afterValue: { status: 'OCCUPIED', sessionNumber: session.sessionNumber },
        metadata: { scannedTable: scanned.tableNumber, combined: target.isCombined },
      });
    } else {
      await tx
        .update(diningSessions)
        .set({ lastActivityAt: new Date() })
        .where(eq(diningSessions.id, session.id));
    }

    // Reuse the device row when the same phone scans again, so a re-scan does
    // not multiply anonymous device records.
    let deviceToken = input.existingDeviceToken ?? null;
    let device = deviceToken
      ? (
          await tx
            .select()
            .from(customerDevices)
            .where(eq(customerDevices.deviceTokenHash, sha256(deviceToken)))
        )[0]
      : undefined;

    if (!device || device.sessionId !== session.id) {
      deviceToken = randomBytes(24).toString('base64url');
      const [created] = await tx
        .insert(customerDevices)
        .values({
          sessionId: session.id,
          deviceTokenHash: sha256(deviceToken),
          userAgentHash: input.userAgentHash ?? null,
        })
        .returning();
      device = created!;
    } else {
      await tx
        .update(customerDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(customerDevices.id, device.id));
    }

    return {
      sessionId: session.id,
      tableId: anchorTable.id,
      tableNumber: anchorTable.tableNumber,
      tableLabel: anchorTable.displayName,
      deviceId: device.id,
      deviceToken: deviceToken!,
      isNewSession,
      isCombined: target.isCombined,
      scannedTableNumber: scanned.tableNumber,
    };
  });
}

/**
 * Guest asks for the bill.
 *
 * The session stays OPEN — only staff close it, and only after payment at the
 * POS. Pressing the button twice does not create a second notification.
 */
export async function requestCheckout(
  db: Db,
  input: { sessionId: string; deviceId: string | null; idempotencyKey?: string },
): Promise<{ alreadyRequested: boolean; requestedAt: Date }> {
  return db.transaction(async (tx: Db) => {
    const [session] = await tx
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, input.sessionId));

    if (!session) throw domainError('SESSION_NOT_FOUND', 'Dining session not found');
    if (session.status === 'CLOSED') {
      throw domainError('SESSION_CLOSED', 'This table session has been closed');
    }

    if (session.checkoutRequestedAt) {
      return { alreadyRequested: true, requestedAt: session.checkoutRequestedAt };
    }

    const requestedAt = new Date();
    await tx
      .update(diningSessions)
      .set({
        status: transitionSession(session.status, 'REQUEST_CHECKOUT'),
        checkoutRequestedAt: requestedAt,
        lastActivityAt: requestedAt,
      })
      .where(eq(diningSessions.id, session.id));

    const totals = await tx
      .select({ total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int` })
      .from(orders)
      .where(and(eq(orders.sessionId, session.id), ne(orders.status, 'CANCELLED')));

    await tx.insert(notifications).values({
      type: 'CHECKOUT_REQUESTED',
      status: 'PENDING',
      sessionId: session.id,
      tableId: session.primaryTableId,
      payload: { sessionTotalCents: totals[0]?.total ?? 0 },
    });

    await tx.insert(auditEvents).values({
      actorType: 'CUSTOMER',
      actorDeviceId: input.deviceId,
      action: 'CHECKOUT_REQUESTED',
      entityType: 'SESSION',
      entityId: session.id,
      tableId: session.primaryTableId,
      sessionId: session.id,
      beforeValue: { status: session.status },
      afterValue: { status: 'CHECKOUT_REQUESTED' },
      metadata: {},
    });

    return { alreadyRequested: false, requestedAt };
  });
}

/**
 * Staff close the session after payment has been taken at the POS.
 *
 * Refuses while any order still awaits waiter action, unless forced with a
 * reason — which is written to the audit trail.
 */
export async function closeSession(
  db: Db,
  input: { sessionId: string; userId: string; force?: boolean; reason?: string | null },
): Promise<{ closedAt: Date; separatedTableNumbers: string[]; finalisedOnClose: number[] }> {
  return db.transaction(async (tx: Db) => {
    const [session] = await tx
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, input.sessionId));

    if (!session) throw domainError('SESSION_NOT_FOUND', 'Dining session not found');
    if (session.status === 'CLOSED') {
      throw domainError('SESSION_CLOSED', 'This session is already closed');
    }

    // A guest who is paying has finished ordering, so anything still inside its
    // edit window counts now. Left open it would strand an order on a closed
    // session and surface later as a notification for a cleared table.
    const finalisedOnClose = await finaliseOpenWindowsForSession(tx, session.id);

    const unresolved = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        sql`${orders.sessionId} = ${session.id}
            and ${orders.status} in ('SUBMITTED', 'EMPLOYEE_REVIEW')`,
      );
    const pendingCount = unresolved[0]?.n ?? 0;

    // The domain rule decides; this service only supplies the facts.
    const nextStatus = transitionSession(
      pendingCount > 0 ? 'ORDER_PENDING' : session.status,
      'CLOSE',
      { force: input.force, reason: input.reason },
    );

    const closedAt = new Date();
    await tx
      .update(diningSessions)
      .set({
        status: nextStatus,
        closedAt,
        closedBy: input.userId,
        closeReason: input.reason ?? null,
        lastActivityAt: closedAt,
      })
      .where(eq(diningSessions.id, session.id));

    await tx
      .update(notifications)
      .set({ status: 'ACKNOWLEDGED', acknowledgedAt: closedAt, acknowledgedBy: input.userId })
      .where(and(eq(notifications.sessionId, session.id), eq(notifications.status, 'PENDING')));

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: input.userId,
      action: pendingCount > 0 ? 'SESSION_FORCE_CLOSED' : 'SESSION_CLOSED',
      entityType: 'SESSION',
      entityId: session.id,
      tableId: session.primaryTableId,
      sessionId: session.id,
      beforeValue: { status: session.status },
      afterValue: { status: 'CLOSED' },
      metadata: {
        reason: input.reason ?? null,
        unresolvedOrders: pendingCount,
        ordersFinalisedOnClose: finalisedOnClose,
      },
    });

    // The party has paid and left, so the tables go back to being separate.
    // Leaving them joined would silently pull the next guests at ANY of those
    // tables into one shared bill.
    let separatedTableNumbers: string[] = [];
    if (session.tableGroupId) {
      separatedTableNumbers = await dissolveGroup(
        tx,
        session.tableGroupId,
        { userId: input.userId, auto: true, reason: 'session closed', sessionId: session.id },
        { clearSessionLinks: false },
      );
    }

    return { closedAt, separatedTableNumbers, finalisedOnClose };
  });
}

/**
 * Closes sessions that have been idle too long (proposal E6, default 4 hours).
 *
 * Guards against the worst failure mode in the whole system: a party leaves
 * without asking for the bill and the next party inherits their open session.
 */
export async function closeIdleSessions(db: Db, idleHours = idleTimeoutHours()): Promise<number> {
  const cutoff = new Date(Date.now() - idleHours * 3600_000);
  const stale = await db
    .select()
    .from(diningSessions)
    // Typed operator, not a raw template: a Date in a raw template reaches the
    // driver without column context and postgres-js cannot serialise it.
    .where(and(ne(diningSessions.status, 'CLOSED'), lt(diningSessions.lastActivityAt, cutoff)));

  for (const session of stale) {
    await db.transaction(async (tx: Db) => {
      const closedAt = new Date();
      await tx
        .update(diningSessions)
        .set({ status: 'CLOSED', closedAt, closeReason: `auto-closed after ${idleHours}h idle` })
        .where(eq(diningSessions.id, session.id));

      await tx.insert(auditEvents).values({
        actorType: 'SYSTEM',
        action: 'SESSION_CLOSED',
        entityType: 'SESSION',
        entityId: session.id,
        tableId: session.primaryTableId,
        sessionId: session.id,
        beforeValue: { status: session.status },
        afterValue: { status: 'CLOSED' },
        metadata: { auto: true, idleHours },
      });

      if (session.tableGroupId) {
        await dissolveGroup(
          tx,
          session.tableGroupId,
          {
            userId: null,
            auto: true,
            reason: `auto-closed after ${idleHours}h idle`,
            sessionId: session.id,
          },
          { clearSessionLinks: false },
        );
      }
    });
  }

  return stale.length;
}

/** The waiter dashboard's table grid. */
export async function getTableOverview(db: Db) {
  return db
    .select({
      tableId: restaurantTables.id,
      tableNumber: restaurantTables.tableNumber,
      displayName: restaurantTables.displayName,
      area: restaurantTables.area,
      sessionId: diningSessions.id,
      sessionNumber: diningSessions.sessionNumber,
      sessionStatus: diningSessions.status,
      openedAt: diningSessions.openedAt,
      checkoutRequestedAt: diningSessions.checkoutRequestedAt,
    })
    .from(restaurantTables)
    .leftJoin(
      diningSessions,
      and(
        eq(diningSessions.primaryTableId, restaurantTables.id),
        ne(diningSessions.status, 'CLOSED'),
      ),
    )
    .where(eq(restaurantTables.isActive, true))
    .orderBy(restaurantTables.tableNumber);
}

/** Every order in a session, newest last, with its running total. */
export async function getSessionDetail(db: Db, sessionId: string) {
  const [session] = await db
    .select()
    .from(diningSessions)
    .where(eq(diningSessions.id, sessionId));
  if (!session) throw domainError('SESSION_NOT_FOUND', 'Dining session not found');

  const [table] = await db
    .select()
    .from(restaurantTables)
    .where(eq(restaurantTables.id, session.primaryTableId));

  const sessionOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.sessionId, sessionId))
    .orderBy(orders.submittedAt);

  const totalCents = sessionOrders
    .filter((o) => o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + o.totalCents, 0);

  // A waiter closing this bill needs to know it covers more than one table —
  // and that closing sends those tables back to serving separately.
  let joinedTables: string[] = [];
  if (session.tableGroupId) {
    const [group] = await db
      .select()
      .from(tableGroups)
      .where(eq(tableGroups.id, session.tableGroupId));
    if (group?.status === 'ACTIVE') {
      const members = await db
        .select({ tableNumber: restaurantTables.tableNumber })
        .from(tableGroupMembers)
        .innerJoin(restaurantTables, eq(restaurantTables.id, tableGroupMembers.tableId))
        .where(
          and(
            eq(tableGroupMembers.tableGroupId, group.id),
            isNull(tableGroupMembers.leftAt),
          ),
        );
      joinedTables = members
        .map((m) => m.tableNumber)
        .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    }
  }

  return { session, table, orders: sessionOrders, totalCents, joinedTables };
}

/** Audit history for a session, order or table. */
export async function getAuditTrail(
  db: Db,
  filter: { sessionId?: string; orderId?: string; tableId?: string },
  limit = 200,
) {
  const conditions = [
    filter.sessionId ? eq(auditEvents.sessionId, filter.sessionId) : undefined,
    filter.orderId ? eq(auditEvents.orderId, filter.orderId) : undefined,
    filter.tableId ? eq(auditEvents.tableId, filter.tableId) : undefined,
  ].filter(Boolean);

  if (conditions.length === 0) {
    throw domainError('VALIDATION_FAILED', 'An audit query needs a session, order or table');
  }

  return db
    .select()
    .from(auditEvents)
    .where(and(...(conditions as any[])))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit);
}

/** Unacknowledged notifications: the authoritative queue behind the SSE stream. */
export async function getPendingNotifications(db: Db) {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      createdAt: notifications.createdAt,
      payload: notifications.payload,
      sessionId: notifications.sessionId,
      orderId: notifications.orderId,
      tableNumber: restaurantTables.tableNumber,
      tableLabel: restaurantTables.displayName,
    })
    .from(notifications)
    .leftJoin(restaurantTables, eq(restaurantTables.id, notifications.tableId))
    .where(eq(notifications.status, 'PENDING'))
    .orderBy(notifications.createdAt);
}

/**
 * Clears an order from the waiter's queue.
 *
 * With orders confirming themselves, "done with this" no longer means
 * confirming it — it means the waiter has seen it and entered it into the POS.
 * That is what the queue is now showing, so that is what has to be clearable.
 */
export async function acknowledgeOrder(
  db: Db,
  input: { orderId: string; userId: string },
): Promise<{ acknowledged: number }> {
  return db.transaction(async (tx: Db) => {
    const rows = await tx
      .update(notifications)
      .set({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: input.userId })
      .where(and(eq(notifications.orderId, input.orderId), eq(notifications.status, 'PENDING')))
      .returning();

    for (const row of rows) {
      await tx.insert(auditEvents).values({
        actorType: 'WAITER',
        actorUserId: input.userId,
        action: 'NOTIFICATION_ACKNOWLEDGED',
        entityType: 'NOTIFICATION',
        entityId: row.id,
        sessionId: row.sessionId,
        orderId: row.orderId,
        tableId: row.tableId,
        metadata: { viaOrder: true },
      });
    }

    return { acknowledged: rows.length };
  });
}

export async function acknowledgeNotification(
  db: Db,
  input: { notificationId: string; userId: string },
): Promise<void> {
  await db.transaction(async (tx: Db) => {
    const [row] = await tx
      .update(notifications)
      .set({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: input.userId })
      .where(and(eq(notifications.id, input.notificationId), eq(notifications.status, 'PENDING')))
      .returning();

    if (row) {
      await tx.insert(auditEvents).values({
        actorType: 'WAITER',
        actorUserId: input.userId,
        action: 'NOTIFICATION_ACKNOWLEDGED',
        entityType: 'NOTIFICATION',
        entityId: row.id,
        sessionId: row.sessionId,
        orderId: row.orderId,
        tableId: row.tableId,
        metadata: { type: row.type },
      });
    }
  });
}

/** Opens a session from the waiter side, for a walk-in seated before scanning. */
export async function openSessionForTable(
  db: Db,
  input: { tableId: string; userId: string },
): Promise<{ sessionId: string }> {
  return db.transaction(async (tx: Db) => {
    const [existing] = await tx
      .select()
      .from(diningSessions)
      .where(
        and(eq(diningSessions.primaryTableId, input.tableId), ne(diningSessions.status, 'CLOSED')),
      );
    if (existing) {
      throw domainError('SESSION_ALREADY_OPEN', 'This table already has an open session');
    }

    const [created] = await tx
      .insert(diningSessions)
      .values({ primaryTableId: input.tableId, status: 'OCCUPIED' })
      .returning();

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: input.userId,
      action: 'SESSION_OPENED',
      entityType: 'SESSION',
      entityId: created!.id,
      tableId: input.tableId,
      sessionId: created!.id,
      afterValue: { status: 'OCCUPIED' },
      metadata: { openedByStaff: true },
    });

    return { sessionId: created!.id };
  });
}

export { isNull };

/**
 * Ends a table group.
 *
 * `clearSessionLinks` is false when a session is closing: a finished session
 * should keep recording that it WAS a joined-table session, because that is how
 * the bill came to cover several tables. Clearing it would quietly rewrite why
 * the history looks the way it does. When staff separate tables mid-service the
 * session is still running, so the link is cleared and it stops being shared.
 */
async function dissolveGroup(
  tx: Db,
  groupId: string,
  actor: { userId: string | null; auto: boolean; reason: string; sessionId?: string },
  options: { clearSessionLinks: boolean },
): Promise<string[]> {
  const [group] = await tx.select().from(tableGroups).where(eq(tableGroups.id, groupId));
  if (!group || group.status !== 'ACTIVE') return [];

  const members = await tx
    .select({ tableNumber: restaurantTables.tableNumber })
    .from(tableGroupMembers)
    .innerJoin(restaurantTables, eq(restaurantTables.id, tableGroupMembers.tableId))
    .where(and(eq(tableGroupMembers.tableGroupId, groupId), isNull(tableGroupMembers.leftAt)));

  const now = new Date();
  await tx
    .update(tableGroupMembers)
    .set({ leftAt: now })
    .where(and(eq(tableGroupMembers.tableGroupId, groupId), isNull(tableGroupMembers.leftAt)));

  await tx
    .update(tableGroups)
    .set({ status: 'DISSOLVED', dissolvedAt: now })
    .where(eq(tableGroups.id, groupId));

  if (options.clearSessionLinks) {
    await tx
      .update(diningSessions)
      .set({ tableGroupId: null })
      .where(eq(diningSessions.tableGroupId, groupId));
  }

  await tx.insert(auditEvents).values({
    actorType: actor.auto ? 'SYSTEM' : 'WAITER',
    actorUserId: actor.userId,
    action: 'TABLE_GROUP_DISSOLVED',
    entityType: 'TABLE_GROUP',
    entityId: groupId,
    tableId: group.anchorTableId,
    // Tie it to the bill when a closing session caused it, so the separation
    // shows up in that session's history rather than only in the global log.
    sessionId: actor.sessionId ?? null,
    beforeValue: { members: members.map((m) => m.tableNumber) },
    metadata: { auto: actor.auto, reason: actor.reason },
  });

  return members.map((m) => m.tableNumber);
}

/**
 * Pushing tables together.
 *
 * Restaurant rules (E4 and its follow-ups):
 *  - Only BEFORE anyone has ordered. Merging is a seating decision, not a way
 *    to combine two bills mid-meal. A table with orders on it is refused, so
 *    no order is ever moved between sessions and no bill is rewritten.
 *  - Only neighbouring tables, and only in one connected run — you cannot push
 *    a table through a divider or across the room.
 *  - The lowest-numbered table anchors the group, and any member's QR reaches
 *    the shared session, so a guest at the far end never hunts for the right
 *    code.
 */
export async function mergeTables(
  db: Db,
  input: { tableIds: readonly string[]; userId: string },
): Promise<{ groupId: string; anchorTableNumber: string; memberTableNumbers: string[] }> {
  if (input.tableIds.length < 2) {
    throw domainError('VALIDATION_FAILED', 'Choose at least two tables to push together');
  }

  return db.transaction(async (tx: Db) => {
    const tables = await tx
      .select()
      .from(restaurantTables)
      .where(inArray(restaurantTables.id, [...input.tableIds]));

    if (tables.length !== input.tableIds.length) {
      throw domainError('VALIDATION_FAILED', 'One of those tables no longer exists');
    }

    const numbers = tables.map((t) => t.tableNumber);

    if (!isConnectedSelection(numbers)) {
      throw domainError(
        'VALIDATION_FAILED',
        'Those tables are not next to each other. Tables can only be joined if they touch, and not across a divider.',
        { tables: numbers },
      );
    }

    // Already joined to something else? The partial unique index would catch it,
    // but a clear message beats a constraint violation.
    const existing = await tx
      .select({ tableId: tableGroupMembers.tableId })
      .from(tableGroupMembers)
      .innerJoin(tableGroups, eq(tableGroups.id, tableGroupMembers.tableGroupId))
      .where(
        and(
          inArray(tableGroupMembers.tableId, [...input.tableIds]),
          isNull(tableGroupMembers.leftAt),
          eq(tableGroups.status, 'ACTIVE'),
        ),
      );
    if (existing.length > 0) {
      const names = tables
        .filter((t) => existing.some((e) => e.tableId === t.id))
        .map((t) => t.tableNumber);
      throw domainError('VALIDATION_FAILED', `Already joined to another table: ${names.join(', ')}`, {
        tables: names,
      });
    }

    // The heart of the restaurant's rule: nothing may have been ordered yet.
    const withOrders = await tx
      .select({ tableId: orders.tableId, n: sql<number>`count(*)::int` })
      .from(orders)
      .innerJoin(diningSessions, eq(diningSessions.id, orders.sessionId))
      .where(
        and(
          inArray(orders.tableId, [...input.tableIds]),
          ne(diningSessions.status, 'CLOSED'),
          ne(orders.status, 'CANCELLED'),
        ),
      )
      .groupBy(orders.tableId);

    if (withOrders.length > 0) {
      const names = tables
        .filter((t) => withOrders.some((w) => w.tableId === t.id))
        .map((t) => t.tableNumber);
      throw domainError(
        'VALIDATION_FAILED',
        `Table ${names.join(', ')} already has orders. Tables can only be joined before anyone has ordered.`,
        { tables: names },
      );
    }

    const anchor = resolveAnchorTable(tables.map((t) => ({ id: t.id, tableNumber: t.tableNumber })));

    const [group] = await tx
      .insert(tableGroups)
      .values({
        status: 'ACTIVE',
        qrPolicy: 'ANY_MEMBER',
        anchorTableId: anchor.id,
        createdBy: input.userId,
        groupName: `Tables ${numbers.slice().sort((a, b) => Number(a) - Number(b)).join(' + ')}`,
      })
      .returning();

    await tx
      .insert(tableGroupMembers)
      .values(tables.map((t) => ({ tableGroupId: group!.id, tableId: t.id })));

    // Any open session on a non-anchor table is closed. Safe, because we have
    // just proved none of them carries an order; the next scan opens one shared
    // session on the anchor.
    const openSessions = await tx
      .select()
      .from(diningSessions)
      .where(
        and(
          inArray(diningSessions.primaryTableId, [...input.tableIds]),
          ne(diningSessions.status, 'CLOSED'),
        ),
      );

    for (const session of openSessions) {
      if (session.primaryTableId === anchor.id) {
        await tx
          .update(diningSessions)
          .set({ tableGroupId: group!.id })
          .where(eq(diningSessions.id, session.id));
        continue;
      }
      await tx
        .update(diningSessions)
        .set({
          status: 'CLOSED',
          closedAt: new Date(),
          closedBy: input.userId,
          closeReason: `table joined to ${anchor.tableNumber}`,
        })
        .where(eq(diningSessions.id, session.id));
    }

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: input.userId,
      action: 'TABLE_GROUP_CREATED',
      entityType: 'TABLE_GROUP',
      entityId: group!.id,
      tableId: anchor.id,
      afterValue: { anchor: anchor.tableNumber, members: numbers },
      metadata: { qrPolicy: 'ANY_MEMBER' },
    });

    return {
      groupId: group!.id,
      anchorTableNumber: anchor.tableNumber,
      memberTableNumbers: numbers.slice().sort((a, b) => Number(a) - Number(b)),
    };
  });
}

/**
 * Separating tables again.
 *
 * The open session stays with the anchor, because the party is still sitting
 * there; the other tables simply become free. Their history is untouched.
 */
export async function unmergeTables(
  db: Db,
  input: { groupId: string; userId: string },
): Promise<{ freedTableNumbers: string[] }> {
  return db.transaction(async (tx: Db) => {
    const [group] = await tx.select().from(tableGroups).where(eq(tableGroups.id, input.groupId));
    if (!group || group.status !== 'ACTIVE') {
      throw domainError('VALIDATION_FAILED', 'Those tables are not joined');
    }

    // The session keeps running on the anchor; it just stops being shared.
    const freed = await dissolveGroup(
      tx,
      group.id,
      { userId: input.userId, auto: false, reason: 'separated by staff' },
      { clearSessionLinks: true },
    );

    return { freedTableNumbers: freed };
  });
}

/** Active groups, for the dashboard. */
export async function getActiveTableGroups(db: Db) {
  const rows = await db
    .select({
      groupId: tableGroups.id,
      anchorTableId: tableGroups.anchorTableId,
      tableId: tableGroupMembers.tableId,
      tableNumber: restaurantTables.tableNumber,
    })
    .from(tableGroups)
    .innerJoin(tableGroupMembers, eq(tableGroupMembers.tableGroupId, tableGroups.id))
    .innerJoin(restaurantTables, eq(restaurantTables.id, tableGroupMembers.tableId))
    .where(and(eq(tableGroups.status, 'ACTIVE'), isNull(tableGroupMembers.leftAt)));

  const groups = new Map<string, { groupId: string; anchorTableId: string | null; tables: string[] }>();
  for (const row of rows) {
    const existing = groups.get(row.groupId) ?? {
      groupId: row.groupId,
      anchorTableId: row.anchorTableId,
      tables: [],
    };
    existing.tables.push(row.tableNumber);
    groups.set(row.groupId, existing);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    tables: g.tables.sort((a, b) => Number(a) - Number(b)),
  }));
}
