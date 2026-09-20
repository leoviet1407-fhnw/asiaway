import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../server/db/index';
import { submitOrder } from '../../../server/services/order-service';
import { orderItems, orderNotes, orderRevisions, orders } from '../../../server/db/schema';
import {
  enforceRateLimit,
  handleApiError,
  requireCustomerContext,
  apiError,
} from '../../../server/http/api';
import { toCustomerVisibleState } from '../../../domain/order/status';

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
 * Submits the cart.
 *
 * Note what the schema does NOT accept: a price, a total, a table number or an
 * order number. All four are server-owned. The Idempotency-Key header is what
 * makes a double tap, a reload or a network retry produce one order.
 */
export async function POST(request: Request) {
  try {
    const context = await requireCustomerContext();

    const limited = await enforceRateLimit('orders.submit', 15, 60_000);
    if (limited) return limited;

    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return apiError('VALIDATION_FAILED', 'A valid Idempotency-Key header is required');
    }

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return apiError('VALIDATION_FAILED', 'The order could not be read', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const result = await submitOrder(await db(), {
      sessionId: context.sessionId,
      deviceId: context.deviceId,
      lines: parsed.data.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      note: parsed.data.note ?? null,
      idempotencyKey,
    });

    // Deliberately no waiter event here. The guest still owns this order for
    // the next minute; the waiter is told when that window closes.

    return NextResponse.json(
      {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        totalCents: result.totalCents,
        submittedAt: result.submittedAt.toISOString(),
        customerWindowExpiresAt: result.customerWindowExpiresAt?.toISOString() ?? null,
        replayed: result.replayed,
      },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * The guest's own orders for this session, read-only.
 *
 * Shows the CURRENT version, flagging where staff adjusted it, which is what
 * "the customer can see the final order if the waiter changes it" asks for.
 * Internal workflow statuses are mapped away before they leave the server.
 */
export async function GET() {
  try {
    const context = await requireCustomerContext();
    const database = await db();

    const sessionOrders = await database
      .select()
      .from(orders)
      .where(eq(orders.sessionId, context.sessionId))
      .orderBy(asc(orders.submittedAt));

    const detailed = await Promise.all(
      sessionOrders.map(async (order) => {
        const items = await database
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
          .orderBy(asc(orderItems.sortIndex));

        const notes = await database
          .select()
          .from(orderNotes)
          .where(and(eq(orderNotes.orderId, order.id), eq(orderNotes.source, 'CUSTOMER')));

        const [original] = await database
          .select({ total: orderRevisions.totalCentsAfter })
          .from(orderRevisions)
          .where(and(eq(orderRevisions.orderId, order.id), eq(orderRevisions.revisionNumber, 0)));

        // The stored status only changes when something sweeps it, which
        // happens on a waiter's screen. Reporting EDITABLE for a window that
        // has already run out would invite a change the server would refuse.
        const windowOpen =
          !!order.customerWindowExpiresAt && order.customerWindowExpiresAt.getTime() > Date.now();
        const state = toCustomerVisibleState(order.status);

        return {
          // The guest needs this to change or send their own order.
          id: order.id,
          orderNumber: order.orderNumber,
          state: state === 'EDITABLE' && !windowOpen ? 'RECEIVED' : state,
          customerWindowExpiresAt: order.customerWindowExpiresAt?.toISOString() ?? null,
          submittedAt: order.submittedAt.toISOString(),
          totalCents: order.totalCents,
          wasAdjustedByStaff: order.currentRevisionNumber > 0 && original?.total !== order.totalCents,
          note: notes[0]?.noteText ?? null,
          items: items.map((i) => ({
            name: { en: i.nameEn, de: i.nameDe, vi: i.nameVi },
            // Needed to put the order back into the cart when the guest
            // changes it inside their window.
            menuItemId: i.menuItemId,
            dishNumber: i.dishNumber,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            lineTotalCents: i.lineTotalCents,
          })),
        };
      }),
    );

    const sessionTotalCents = sessionOrders
      .filter((o) => o.status !== 'CANCELLED')
      .reduce((sum, o) => sum + o.totalCents, 0);

    return NextResponse.json({ orders: detailed, sessionTotalCents });
  } catch (error) {
    return handleApiError(error);
  }
}
