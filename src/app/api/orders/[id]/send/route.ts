import { NextResponse } from 'next/server';
import { db } from '../../../../../server/db/index';
import { sendOrderNow } from '../../../../../server/services/order-service';
import { publishWaiterEvent } from '../../../../../server/notifications/hub';
import {
  enforceRateLimit,
  handleApiError,
  requireCustomerContext,
} from '../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The guest sending their order to the kitchen without waiting out the window.
 *
 * Safe to call twice: an order already gone reports back that it has gone,
 * rather than failing, because a double tap on a phone is normal.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const customer = await requireCustomerContext();

    const limited = await enforceRateLimit('orders.send', 20, 60_000);
    if (limited) return limited;

    const { id } = await context.params;
    const result = await sendOrderNow(await db(), { orderId: id, deviceId: customer.deviceId });

    if (!result.alreadySent) {
      // Now the waiter hears about it — one settled order.
      publishWaiterEvent('new_order', { orderId: id, orderNumber: result.orderNumber });
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
