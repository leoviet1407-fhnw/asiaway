import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import { getActiveTableGroups, mergeTables } from '../../../../server/services/session-service';
import { publishWaiterEvent } from '../../../../server/notifications/hub';
import { apiError, handleApiError, withWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ tableIds: z.array(z.string().uuid()).min(2).max(12) });

export async function GET() {
  try {
    return (await withWaiter(async () => {
      return NextResponse.json({ groups: await getActiveTableGroups(await db()) });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

/** Push tables together. Refused once anything has been ordered on them. */
export async function POST(request: Request) {
  try {
    return (await withWaiter(async (user) => {
      const parsed = Body.safeParse(await request.json());
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'Choose at least two tables to push together');
      }

      const result = await mergeTables(await db(), {
        tableIds: parsed.data.tableIds,
        userId: user.id,
      });

      publishWaiterEvent('order_updated', { tablesMerged: result.groupId });
      return NextResponse.json(result, { status: 201 });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
