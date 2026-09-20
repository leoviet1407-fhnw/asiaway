import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../../server/db/index';
import { setAvailability } from '../../../../../../server/services/menu-service';
import { publishWaiterEvent } from '../../../../../../server/notifications/hub';
import { apiError, handleApiError, withWaiter } from '../../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ isAvailable: z.boolean(), reason: z.string().max(200).nullable().optional() });

/** Sold-out toggle. A data change: takes effect at once, with no deployment. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      const parsed = Body.safeParse(await request.json());
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'isAvailable must be true or false');

      const result = await setAvailability(await db(), {
        menuItemId: id,
        isAvailable: parsed.data.isAvailable,
        userId: user.id,
        reason: parsed.data.reason ?? null,
      });

      publishWaiterEvent('availability_changed', { menuItemId: id, ...result });
      return NextResponse.json(result);
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
