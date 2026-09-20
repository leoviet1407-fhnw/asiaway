import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asc, desc, inArray } from 'drizzle-orm';
import { db } from '../../../../server/db/index';
import { rosterPeriods } from '../../../../server/db/schema';
import { closeMonth, getMonthlyStatement } from '../../../../server/services/timesheet-service';
import { apiError, handleApiError, withManager } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return (await withManager(async () => {
      const database = await db();
      const requested = new URL(request.url).searchParams.get('period');

      const periods = await database
        .select({
          id: rosterPeriods.id,
          startsOn: rosterPeriods.startsOn,
          endsOn: rosterPeriods.endsOn,
          state: rosterPeriods.state,
        })
        .from(rosterPeriods)
        .orderBy(desc(rosterPeriods.startsOn));

      // Default to the oldest month that is not yet closed: that is the one
      // waiting to be settled, not the one being planned.
      const periodId =
        requested ??
        [...periods].reverse().find((p) => p.state !== 'LOCKED')?.id ??
        periods[0]?.id;

      if (!periodId) return NextResponse.json({ period: null, periods: [], lines: [] });

      return NextResponse.json({ ...(await getMonthlyStatement(database, periodId)), periods, periodId });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const Body = z.object({ periodId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    return (await withManager(async (manager) => {
      const parsed = Body.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'No month was given');

      const database = await db();
      await closeMonth(database, parsed.data.periodId, manager.id);
      return NextResponse.json(await getMonthlyStatement(database, parsed.data.periodId));
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
