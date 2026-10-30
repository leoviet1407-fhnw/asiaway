import { NextResponse } from 'next/server';
import { db } from '../../../server/db/index';
import { callStaff } from '../../../server/services/session-service';
import { publishWaiterEvent } from '../../../server/notifications/hub';
import {
  apiError,
  enforceRateLimit,
  handleApiError,
  requireCustomerContext,
} from '../../../server/http/api';
import { RESTAURANT } from '../../../config/restaurant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The guest calls a member of staff to their table.
 *
 * Pressing twice is harmless: while a call is still waiting, a second press
 * returns the first one's moment and alerts nobody again. Only offered where
 * the restaurant works this way.
 */
export async function POST() {
  try {
    if (!RESTAURANT.guestCallsStaff) {
      return apiError('NOT_FOUND', 'Calling staff is not available here', undefined, 404);
    }

    const context = await requireCustomerContext();

    const limited = await enforceRateLimit('staff.call', 10, 60_000);
    if (limited) return limited;

    const result = await callStaff(await db(), {
      sessionId: context.sessionId,
      deviceId: context.deviceId,
    });

    if (!result.alreadyCalled) {
      publishWaiterEvent('staff_called', { sessionId: context.sessionId });
    }

    return NextResponse.json({
      alreadyCalled: result.alreadyCalled,
      calledAt: result.calledAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
