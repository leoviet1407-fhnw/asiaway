import { NextResponse } from 'next/server';
import { db } from '../../../../server/db/index';
import { getPendingNotifications } from '../../../../server/services/session-service';
import { handleApiError, withWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The authoritative pending queue.
 *
 * Devices read this on connect and on every reconnect, which is what makes a
 * dropped SSE stream a latency problem rather than a missed order.
 */
export async function GET() {
  try {
    return (await withWaiter(async () => {
      const pending = await getPendingNotifications(await db());
      return NextResponse.json({
        notifications: pending.map((n) => ({
          id: n.id,
          type: n.type,
          createdAt: n.createdAt.toISOString(),
          tableNumber: n.tableNumber,
          tableLabel: n.tableLabel,
          sessionId: n.sessionId,
          orderId: n.orderId,
          payload: n.payload,
        })),
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
