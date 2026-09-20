import { NextResponse } from 'next/server';
import { db } from '../../../server/db/index';
import { requestCheckout } from '../../../server/services/session-service';
import { publishWaiterEvent } from '../../../server/notifications/hub';
import { enforceRateLimit, handleApiError, requireCustomerContext } from '../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The guest asks for the bill.
 *
 * Pressing twice is harmless: the session records when the bill was first asked
 * for, and a second press returns that same moment without creating a second
 * notification. The session stays open either way — only staff close it, after
 * payment at the POS.
 */
export async function POST() {
  try {
    const context = await requireCustomerContext();

    const limited = await enforceRateLimit('checkout.request', 10, 60_000);
    if (limited) return limited;

    const result = await requestCheckout(await db(), {
      sessionId: context.sessionId,
      deviceId: context.deviceId,
    });

    if (!result.alreadyRequested) {
      publishWaiterEvent('checkout_requested', { sessionId: context.sessionId });
    }

    return NextResponse.json({
      alreadyRequested: result.alreadyRequested,
      requestedAt: result.requestedAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
