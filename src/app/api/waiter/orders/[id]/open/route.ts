import { NextResponse } from 'next/server';
import { db } from '../../../../../../server/db/index';
import { openOrderForReview } from '../../../../../../server/services/order-service';
import { handleApiError, withWaiter } from '../../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return (await withWaiter(async (user) => {
      const { id } = await context.params;
      await openOrderForReview(await db(), { orderId: id, userId: user.id });
      return NextResponse.json({ ok: true });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
