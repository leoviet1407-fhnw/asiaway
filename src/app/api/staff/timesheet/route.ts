import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import {
  clockIn,
  clockOut,
  disputeEntry,
  getTimesheet,
} from '../../../../server/services/timesheet-service';
import { localDateIn, RESTAURANT_TIME_ZONE } from '../../../../domain/roster/time';
import { apiError, handleApiError, withStaffMember } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Defaults to the calendar month the restaurant is currently in. */
function monthBounds(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  return {
    from: `${today.slice(0, 7)}-01`,
    to: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10),
  };
}

export async function GET(request: Request) {
  try {
    return (await withStaffMember(async (user) => {
      const params = new URL(request.url).searchParams;
      const today = localDateIn(new Date(), RESTAURANT_TIME_ZONE);
      const bounds = monthBounds(params.get('month') ? `${params.get('month')}-01` : today);
      const from = params.get('from') ?? bounds.from;
      const to = params.get('to') ?? bounds.to;

      return NextResponse.json({
        today,
        timeZone: RESTAURANT_TIME_ZONE,
        ...(await getTimesheet(await db(), user.id, from, to)),
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('clockIn') }),
  z.object({ action: z.literal('clockOut'), breakMinutes: z.number().int().min(0).max(600) }),
  z.object({
    action: z.literal('dispute'),
    entryId: z.string().uuid(),
    reason: z.string().min(1).max(280),
  }),
]);

/** Always the caller's own hours; the user id comes from the session. */
export async function POST(request: Request) {
  try {
    return (await withStaffMember(async (user) => {
      const parsed = Action.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'That action was not understood');

      const database = await db();
      const body = parsed.data;

      if (body.action === 'clockIn') await clockIn(database, user.id);
      else if (body.action === 'clockOut') await clockOut(database, user.id, body.breakMinutes);
      else await disputeEntry(database, body.entryId, user.id, body.reason);

      const today = localDateIn(new Date(), RESTAURANT_TIME_ZONE);
      const bounds = monthBounds(today);
      return NextResponse.json({
        today,
        timeZone: RESTAURANT_TIME_ZONE,
        ...(await getTimesheet(database, user.id, bounds.from, bounds.to)),
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
