import { NextResponse } from 'next/server';
import { db } from '../../../../../../server/db/index';
import { acknowledgeNotification } from '../../../../../../server/services/session-service';
import { publishWaiterEvent } from '../../../../../../server/notifications/hub';
import { handleApiError, withWaiter } from '../../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      await acknowledgeNotification(await db(), { notificationId: id, userId: user.id });
      // Fan out so every other tablet clears the same alert.
      publishWaiterEvent('order_updated', { acknowledged: id });
      return NextResponse.json({ ok: true });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
