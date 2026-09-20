import { NextResponse } from 'next/server';
import { db } from '../../../../server/db/index';
import { getAuditTrail } from '../../../../server/services/session-service';
import { handleApiError, withWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return (await withWaiter(async () => {
      const params = new URL(request.url).searchParams;
      const events = await getAuditTrail(await db(), {
        sessionId: params.get('sessionId') ?? undefined,
        orderId: params.get('orderId') ?? undefined,
        tableId: params.get('tableId') ?? undefined,
      });

      return NextResponse.json({
        events: events.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt.toISOString(),
          actorType: e.actorType,
          actorUserId: e.actorUserId,
          action: e.action,
          entityType: e.entityType,
          beforeValue: e.beforeValue,
          afterValue: e.afterValue,
          metadata: e.metadata,
        })),
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
