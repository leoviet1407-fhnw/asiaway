import { NextResponse } from 'next/server';
import { db } from '../../../../../../server/db/index';
import { acknowledgeOrder } from '../../../../../../server/services/session-service';
import { publishWaiterEvent } from '../../../../../../server/notifications/hub';
import { handleApiError, withWaiter } from '../../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The waiter has dealt with this order — it leaves the queue. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      const result = await acknowledgeOrder(await db(), { orderId: id, userId: user.id });
      publishWaiterEvent('order_updated', { orderId: id });
      return NextResponse.json(result);
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
