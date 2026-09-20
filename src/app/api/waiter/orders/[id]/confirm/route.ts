import { NextResponse } from 'next/server';
import { db } from '../../../../../../server/db/index';
import { confirmOrder } from '../../../../../../server/services/order-service';
import { publishWaiterEvent } from '../../../../../../server/notifications/hub';
import { handleApiError, withWaiter } from '../../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Confirms the order after the waiter has checked it at the table.
 * This is the point at which it is ready to be keyed into the POS by hand.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      const result = await confirmOrder(await db(), { orderId: id, userId: user.id });
      publishWaiterEvent('order_updated', { orderId: id, confirmed: true });
      return NextResponse.json(result);
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
