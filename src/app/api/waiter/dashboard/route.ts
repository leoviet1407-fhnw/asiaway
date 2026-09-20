import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '../../../../server/db/index';
import { orders } from '../../../../server/db/schema';
import {
  getActiveTableGroups,
  getPendingNotifications,
  getTableOverview,
} from '../../../../server/services/session-service';
import { finaliseExpiredOrders } from '../../../../server/services/order-service';
import { tableDisplayState } from '../../../../domain/session/status';
import { handleApiError, withWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return (await withWaiter(async () => {
      const database = await db();

      // Close any guest window that has run out. Nothing schedules this on a
      // serverless host, so the waiter's own screen is what drives it — the
      // same approach as expiring a stale session at scan time.
      await finaliseExpiredOrders(database);

      const [tables, pending, groups] = await Promise.all([
        getTableOverview(database),
        getPendingNotifications(database),
        getActiveTableGroups(database),
      ]);

      const counts = await database
        .select({
          sessionId: orders.sessionId,
          pending: sql<number>`count(*) filter (where ${orders.status} in ('SUBMITTED','EMPLOYEE_REVIEW'))::int`,
          // An order the guest is still editing is not yet money owed, and
          // showing a total that then changes would be worse than showing none.
          total: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} not in ('CANCELLED','AWAITING_CUSTOMER')), 0)::int`,
          orderCount: sql<number>`count(*) filter (where ${orders.status} not in ('CANCELLED','AWAITING_CUSTOMER'))::int`,
        })
        .from(orders)
        .groupBy(orders.sessionId);

      const bySession = new Map(counts.map((c) => [c.sessionId, c]));

      return NextResponse.json({
        tables: tables.map((t) => {
          const stats = t.sessionId ? bySession.get(t.sessionId) : undefined;
          return {
            tableId: t.tableId,
            tableNumber: t.tableNumber,
            displayName: t.displayName,
            area: t.area,
            state: tableDisplayState(t.sessionStatus),
            sessionId: t.sessionId,
            sessionNumber: t.sessionNumber,
            openedAt: t.openedAt?.toISOString() ?? null,
            checkoutRequestedAt: t.checkoutRequestedAt?.toISOString() ?? null,
            pendingOrders: stats?.pending ?? 0,
            orderCount: stats?.orderCount ?? 0,
            sessionTotalCents: stats?.total ?? 0,
          };
        }),
        groups,
        newOrderCount: pending.filter((n) => n.type === 'NEW_ORDER').length,
        checkoutRequestCount: pending.filter((n) => n.type === 'CHECKOUT_REQUESTED').length,
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
