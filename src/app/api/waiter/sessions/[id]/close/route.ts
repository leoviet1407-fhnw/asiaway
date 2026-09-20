import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../../server/db/index';
import { closeSession } from '../../../../../../server/services/session-service';
import { publishWaiterEvent } from '../../../../../../server/notifications/hub';
import { apiError, handleApiError, withWaiter } from '../../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  force: z.boolean().optional(),
  reason: z.string().max(200).nullable().optional(),
});

/**
 * Closes the table session AFTER payment has been taken at the POS.
 *
 * Refuses while any order still awaits waiter action, unless explicitly forced
 * with a reason — which goes into the audit trail.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      const body = await request.json().catch(() => ({}));
      const parsed = Body.safeParse(body);
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'Invalid close request');

      const result = await closeSession(await db(), {
        sessionId: id,
        userId: user.id,
        force: parsed.data.force,
        reason: parsed.data.reason ?? null,
      });

      publishWaiterEvent('order_updated', { sessionClosed: id });
      return NextResponse.json({
        closedAt: result.closedAt.toISOString(),
        separatedTableNumbers: result.separatedTableNumbers,
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
