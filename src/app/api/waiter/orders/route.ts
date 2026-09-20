import { NextResponse } from 'next/server';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../../../server/db/index';
import { diningSessions, orderItems, orderNotes, orders, restaurantTables } from '../../../../server/db/schema';
import { z } from 'zod';
import { createOrderForTable } from '../../../../server/services/order-service';
import { publishWaiterEvent } from '../../../../server/notifications/hub';
import { apiError, handleApiError, withWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The pending queue: submitted and in-review orders, oldest first. */
export async function GET() {
  try {
    return (await withWaiter(async () => {
      const database = await db();

      const rows = await database
        .select({ order: orders, table: restaurantTables, session: diningSessions })
        .from(orders)
        .innerJoin(restaurantTables, eq(restaurantTables.id, orders.tableId))
        .innerJoin(diningSessions, eq(diningSessions.id, orders.sessionId))
        .where(inArray(orders.status, ['SUBMITTED', 'EMPLOYEE_REVIEW']))
        .orderBy(asc(orders.submittedAt));

      const detailed = await Promise.all(
        rows.map(async ({ order, table }) => {
          const items = await database
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, order.id))
            .orderBy(asc(orderItems.sortIndex));
          const notes = await database
            .select()
            .from(orderNotes)
            .where(eq(orderNotes.orderId, order.id))
            .orderBy(asc(orderNotes.createdAt));

          return {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            tableNumber: table.tableNumber,
            tableLabel: table.displayName,
            sessionId: order.sessionId,
            submittedAt: order.submittedAt.toISOString(),
            totalCents: order.totalCents,
            itemCount: items.reduce((n, i) => n + i.quantity, 0),
            customerNote: notes.find((n) => n.source === 'CUSTOMER')?.noteText ?? null,
            items: items.map((i) => ({
              menuItemId: i.menuItemId,
              dishNumber: i.dishNumber,
              name: i.nameEn,
              quantity: i.quantity,
              unitPriceCents: i.unitPriceCents,
              lineTotalCents: i.lineTotalCents,
            })),
          };
        }),
      );

      return NextResponse.json({ orders: detailed });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const CreateBody = z.object({
  tableId: z.string().uuid(),
  items: z
    .array(z.object({ menuItemId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(60),
  note: z.string().max(500).nullable().optional(),
});

/**
 * A waiter takes an order at the table, for guests not using their own phone.
 *
 * Confirmed on creation: the review step exists to check what a guest sent,
 * and here the waiter is the one taking it. The Idempotency-Key still matters —
 * a tablet on restaurant wi-fi retries like any other client.
 */
export async function POST(request: Request) {
  try {
    return (await withWaiter(async (user) => {
      const idempotencyKey = request.headers.get('Idempotency-Key');
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        return apiError('VALIDATION_FAILED', 'A valid Idempotency-Key header is required');
      }

      const parsed = CreateBody.safeParse(await request.json());
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'The order could not be read', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }

      const result = await createOrderForTable(await db(), {
        tableId: parsed.data.tableId,
        userId: user.id,
        lines: parsed.data.items,
        note: parsed.data.note ?? null,
        idempotencyKey,
      });

      if (!result.replayed) publishWaiterEvent('order_updated', { orderId: result.orderId });

      return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
