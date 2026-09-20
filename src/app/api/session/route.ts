import { NextResponse } from 'next/server';
import { eq, ne, and, sql } from 'drizzle-orm';
import { db } from '../../../server/db/index';
import { diningSessions, orders, restaurantTables } from '../../../server/db/schema';
import { getCustomerContext, handleApiError } from '../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The guest's own session summary. Returns `active: false` once staff close it. */
export async function GET() {
  try {
    const context = await getCustomerContext();
    if (!context) return NextResponse.json({ active: false, reason: 'NO_SESSION' });

    const database = await db();
    const rows = await database
      .select({
        status: diningSessions.status,
        checkoutRequestedAt: diningSessions.checkoutRequestedAt,
        tableNumber: restaurantTables.tableNumber,
        tableLabel: restaurantTables.displayName,
      })
      .from(diningSessions)
      .innerJoin(restaurantTables, eq(restaurantTables.id, diningSessions.primaryTableId))
      .where(eq(diningSessions.id, context.sessionId));

    const session = rows[0];
    if (!session || session.status === 'CLOSED') {
      return NextResponse.json({ active: false, reason: 'SESSION_CLOSED' });
    }

    const totals = await database
      .select({
        total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(eq(orders.sessionId, context.sessionId), ne(orders.status, 'CANCELLED')));

    return NextResponse.json({
      active: true,
      tableNumber: session.tableNumber,
      tableLabel: session.tableLabel,
      checkoutRequestedAt: session.checkoutRequestedAt?.toISOString() ?? null,
      orderCount: totals[0]?.count ?? 0,
      sessionTotalCents: totals[0]?.total ?? 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
