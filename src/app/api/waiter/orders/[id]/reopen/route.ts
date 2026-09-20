import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../../server/db/index';
import { reopenOrder } from '../../../../../../server/services/order-service';
import { publishWaiterEvent } from '../../../../../../server/notifications/hub';
import { apiError, handleApiError, withWaiter } from '../../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ reason: z.string().max(200).nullable().optional() });

/**
 * Reopens a confirmed order at the guest's request.
 *
 * The emergency route: once the guest's window has closed they cannot change
 * anything themselves, so they ask staff. Recorded with a reason, because an
 * order that changes after the kitchen has seen it is what an audit trail is
 * for.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      const parsed = Body.safeParse(await request.json().catch(() => ({})));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'Invalid request');

      const result = await reopenOrder(await db(), {
        orderId: id,
        userId: user.id,
        reason: parsed.data.reason?.trim() || null,
      });

      publishWaiterEvent('order_updated', { orderId: id });
      return NextResponse.json(result);
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
