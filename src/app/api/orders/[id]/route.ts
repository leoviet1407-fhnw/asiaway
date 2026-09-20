import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import { editOrderAsCustomer } from '../../../../server/services/order-service';
import {
  apiError,
  enforceRateLimit,
  handleApiError,
  requireCustomerContext,
} from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  items: z
    .array(z.object({ menuItemId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(60),
  note: z.string().max(500).nullable().optional(),
});

/**
 * The guest changing their own order inside the 60-second window.
 *
 * Accepts the same shape as submitting: items and a note, never a price or a
 * total. The service refuses once the window has closed, and refuses outright
 * for a device sitting at a different table.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const customer = await requireCustomerContext();

    const limited = await enforceRateLimit('orders.edit', 30, 60_000);
    if (limited) return limited;

    const { id } = await context.params;
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return apiError('VALIDATION_FAILED', 'The change could not be read');
    }

    const result = await editOrderAsCustomer(await db(), {
      orderId: id,
      deviceId: customer.deviceId,
      lines: parsed.data.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      note: parsed.data.note ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
