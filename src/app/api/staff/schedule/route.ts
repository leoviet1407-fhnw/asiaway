import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import { acknowledgeShift, getMySchedule } from '../../../../server/services/roster-service';
import { localDateIn, RESTAURANT_TIME_ZONE } from '../../../../domain/roster/time';
import { apiError, handleApiError, withStaffMember } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** My published shifts from today onward. */
export async function GET() {
  try {
    return (await withStaffMember(async (user) => {
      const today = localDateIn(new Date(), RESTAURANT_TIME_ZONE);
      return NextResponse.json({
        today,
        timeZone: RESTAURANT_TIME_ZONE,
        shifts: await getMySchedule(await db(), user.id, today),
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const Body = z.object({ shiftId: z.string().uuid() });

/** Confirming a shift has been seen. Only ever one's own. */
export async function POST(request: Request) {
  try {
    return (await withStaffMember(async (user) => {
      const parsed = Body.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'No shift was given');

      const database = await db();
      await acknowledgeShift(database, parsed.data.shiftId, user.id);
      const today = localDateIn(new Date(), RESTAURANT_TIME_ZONE);
      return NextResponse.json({
        today,
        timeZone: RESTAURANT_TIME_ZONE,
        shifts: await getMySchedule(database, user.id, today),
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
