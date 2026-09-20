import { NextResponse } from 'next/server';
import { db } from '../../../../../server/db/index';
import { unmergeTables } from '../../../../../server/services/session-service';
import { publishWaiterEvent } from '../../../../../server/notifications/hub';
import { handleApiError, withWaiter } from '../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Separate joined tables. The session stays with the anchor. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      const result = await unmergeTables(await db(), { groupId: id, userId: user.id });
      publishWaiterEvent('order_updated', { tablesSeparated: id });
      return NextResponse.json(result);
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
