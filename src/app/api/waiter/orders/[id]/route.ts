import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../../../server/db/index';
import { editOrder } from '../../../../../server/services/order-service';
import {
  diningSessions,
  orderItems,
  orderNotes,
  orderRevisions,
  orders,
  restaurantTables,
} from '../../../../../server/db/schema';
import { publishWaiterEvent } from '../../../../../server/notifications/hub';
import { apiError, handleApiError, withWaiter } from '../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One order, with its full revision history so the waiter can see the original. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async () => {
      const { id } = await context.params;
      const database = await db();

      const rows = await database
        .select({ order: orders, table: restaurantTables, session: diningSessions })
        .from(orders)
        .innerJoin(restaurantTables, eq(restaurantTables.id, orders.tableId))
        .innerJoin(diningSessions, eq(diningSessions.id, orders.sessionId))
        .where(eq(orders.id, id));

      const row = rows[0];
      if (!row) return apiError('ORDER_NOT_FOUND', 'Order not found');

      const [items, notes, revisions] = await Promise.all([
        database.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.sortIndex)),
        database.select().from(orderNotes).where(eq(orderNotes.orderId, id)).orderBy(asc(orderNotes.createdAt)),
        database
          .select()
          .from(orderRevisions)
          .where(eq(orderRevisions.orderId, id))
          .orderBy(asc(orderRevisions.revisionNumber)),
      ]);

      return NextResponse.json({
        id: row.order.id,
        orderNumber: row.order.orderNumber,
        status: row.order.status,
        currentRevisionNumber: row.order.currentRevisionNumber,
        tableNumber: row.table.tableNumber,
        tableLabel: row.table.displayName,
        sessionId: row.order.sessionId,
        submittedAt: row.order.submittedAt.toISOString(),
        confirmedAt: row.order.confirmedAt?.toISOString() ?? null,
        totalCents: row.order.totalCents,
        customerNote: notes.find((n) => n.source === 'CUSTOMER')?.noteText ?? null,
        waiterNote: notes.filter((n) => n.source === 'WAITER').at(-1)?.noteText ?? null,
        items: items.map((i) => ({
          menuItemId: i.menuItemId,
          dishNumber: i.dishNumber,
          name: i.nameEn,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          lineTotalCents: i.lineTotalCents,
          allergenCodes: i.allergenCodes,
        })),
        // The original customer submission travels with every response, so the
        // waiter can always see what the guest actually asked for.
        originalSubmission: revisions.find((r) => r.revisionNumber === 0)?.afterSnapshot ?? null,
        revisions: revisions.map((r) => ({
          revisionNumber: r.revisionNumber,
          revisionType: r.revisionType,
          createdAt: r.createdAt.toISOString(),
          reason: r.reason,
          totalCentsBefore: r.totalCentsBefore,
          totalCentsAfter: r.totalCentsAfter,
        })),
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const PatchBody = z.object({
  items: z
    .array(z.object({ menuItemId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(60),
  waiterNote: z.string().max(500).nullable().optional(),
  reason: z.string().max(200).nullable().optional(),
  expectedRevisionNumber: z.number().int().min(0),
});

/** Edits an order. Creates a revision; never overwrites the original. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      const parsed = PatchBody.safeParse(await request.json());
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'The edit could not be read', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }

      const result = await editOrder(await db(), {
        orderId: id,
        userId: user.id,
        lines: parsed.data.items,
        waiterNote: parsed.data.waiterNote,
        reason: parsed.data.reason ?? null,
        expectedRevisionNumber: parsed.data.expectedRevisionNumber,
      });

      if (result.changed) publishWaiterEvent('order_updated', { orderId: id });
      return NextResponse.json(result);
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
