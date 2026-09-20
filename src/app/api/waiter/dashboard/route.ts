import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '../../../../server/db/index';
import { orders } from '../../../../server/db/schema';
import { getPendingNotifications, getTableOverview } from '../../../../server/services/session-service';
import { tableDisplayState } from '../../../../domain/session/status';
import { handleApiError, withWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return (await withWaiter(async () => {
      const database = await db();
      const [tables, pending] = await Promise.all([
        getTableOverview(database),
        getPendingNotifications(database),
      ]);

      const counts = await database
        .select({
          sessionId: orders.sessionId,
          pending: sql<number>`count(*) filter (where ${orders.status} in ('SUBMITTED','EMPLOYEE_REVIEW'))::int`,
          total: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'CANCELLED'), 0)::int`,
          orderCount: sql<number>`count(*) filter (where ${orders.status} <> 'CANCELLED')::int`,
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
        newOrderCount: pending.filter((n) => n.type === 'NEW_ORDER').length,
        checkoutRequestCount: pending.filter((n) => n.type === 'CHECKOUT_REQUESTED').length,
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
