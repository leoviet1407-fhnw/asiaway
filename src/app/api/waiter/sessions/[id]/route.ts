import { NextResponse } from 'next/server';
import { db } from '../../../../../server/db/index';
import { getSessionDetail } from '../../../../../server/services/session-service';
import { handleApiError, withWaiter } from '../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async () => {
      const { id } = await context.params;
      const detail = await getSessionDetail(await db(), id);
      return NextResponse.json({
        session: {
          id: detail.session.id,
          sessionNumber: detail.session.sessionNumber,
          status: detail.session.status,
          openedAt: detail.session.openedAt.toISOString(),
          checkoutRequestedAt: detail.session.checkoutRequestedAt?.toISOString() ?? null,
          closedAt: detail.session.closedAt?.toISOString() ?? null,
        },
        table: detail.table
          ? {
              id: detail.table.id,
              tableNumber: detail.table.tableNumber,
              displayName: detail.table.displayName,
            }
          : null,
        orders: detail.orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          submittedAt: o.submittedAt.toISOString(),
          confirmedAt: o.confirmedAt?.toISOString() ?? null,
          totalCents: o.totalCents,
          currentRevisionNumber: o.currentRevisionNumber,
        })),
        totalCents: detail.totalCents,
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
