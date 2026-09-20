import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { transitionSession } from '../../domain/session/status';
import {
  resolveScanTarget,
  type TableGroupPolicy,
  type TableRef,
} from '../../domain/session/table-group';
import { isWellFormedQrToken } from '../../domain/session/qr-token';
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
): Promise<{ closedAt: Date }> {
  return db.transaction(async (tx: Db) => {
    const [session] = await tx
      .select()
      .from(diningSessions)
      .where(eq(diningSessions.id, input.sessionId));

    if (!session) throw domainError('SESSION_NOT_FOUND', 'Dining session not found');
    if (session.status === 'CLOSED') {
      throw domainError('SESSION_CLOSED', 'This session is already closed');
    }

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
      metadata: { reason: input.reason ?? null, unresolvedOrders: pendingCount },
    });

    return { closedAt };
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
    .where(and(ne(diningSessions.status, 'CLOSED'), sql`${diningSessions.lastActivityAt} < ${cutoff}`));

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

  return { session, table, orders: sessionOrders, totalCents };
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
