import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { db } from '../../../../server/db/index';
import { rosterPeriods } from '../../../../server/db/schema';
import {
  assignShift,
  generatePeriod,
  getRosterGrid,
  publishPeriod,
} from '../../../../server/services/roster-service';
import { apiError, handleApiError, withManager } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The grid for a period, or for the one currently being planned. */
export async function GET(request: Request) {
  try {
    return (await withManager(async () => {
      const database = await db();
      const requested = new URL(request.url).searchParams.get('period');

      const periodId = requested ?? (await currentPeriodId(database));
      if (!periodId) {
        return NextResponse.json({ period: null, periods: [] });
      }
      // The selector needs every month, not just the one being shown.
      const periods = await database
        .select({
          id: rosterPeriods.id,
          startsOn: rosterPeriods.startsOn,
          endsOn: rosterPeriods.endsOn,
          state: rosterPeriods.state,
        })
        .from(rosterPeriods)
        .orderBy(desc(rosterPeriods.startsOn));

      return NextResponse.json({ ...(await getRosterGrid(database, periodId)), periods });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * The month a manager most likely wants: one still being worked on, earliest
 * first. Only if none is open does it fall back to the newest published one —
 * opening on a finished month and wondering why nothing can be edited is a
 * worse first impression than opening on the one in progress.
 */
async function currentPeriodId(database: Awaited<ReturnType<typeof db>>): Promise<string | null> {
  const [open] = await database
    .select({ id: rosterPeriods.id })
    .from(rosterPeriods)
    .where(inArray(rosterPeriods.state, ['DRAFT', 'AVAILABILITY_OPEN', 'PLANNING']))
    .orderBy(asc(rosterPeriods.startsOn))
    .limit(1);
  if (open) return open.id;

  const [recent] = await database
    .select({ id: rosterPeriods.id })
    .from(rosterPeriods)
    .where(ne(rosterPeriods.state, 'LOCKED'))
    .orderBy(desc(rosterPeriods.startsOn))
    .limit(1);
  return recent?.id ?? null;
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), periodId: z.string().uuid() }),
  z.object({
    action: z.literal('assign'),
    shiftId: z.string().uuid(),
    userId: z.string().uuid().nullable(),
  }),
  z.object({ action: z.literal('publish'), periodId: z.string().uuid() }),
  z.object({ action: z.literal('openPlanning'), periodId: z.string().uuid() }),
]);

/**
 * Generating, assigning and publishing, behind one endpoint.
 *
 * Every response is the whole grid, revalidated. A manager who has just made
 * a change wants to see what it did to the violations panel, and returning
 * anything less invites the screen and the database to drift apart.
 */
export async function POST(request: Request) {
  try {
    return (await withManager(async (user) => {
      const parsed = Action.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'That action was not understood');

      const database = await db();
      const body = parsed.data;

      if (body.action === 'assign') {
        await assignShift(database, body.shiftId, body.userId);
        const { shifts } = await import('../../../../server/db/schema');
        const [row] = await database
          .select({ periodId: shifts.periodId })
          .from(shifts)
          .where(eq(shifts.id, body.shiftId));
        return NextResponse.json(await getRosterGrid(database, row!.periodId));
      }

      if (body.action === 'generate') {
        await generatePeriod(database, body.periodId);
        await database
          .update(rosterPeriods)
          .set({ state: 'PLANNING' })
          .where(eq(rosterPeriods.id, body.periodId));
        return NextResponse.json(await getRosterGrid(database, body.periodId));
      }

      if (body.action === 'openPlanning') {
        await database
          .update(rosterPeriods)
          .set({ state: 'PLANNING' })
          .where(eq(rosterPeriods.id, body.periodId));
        return NextResponse.json(await getRosterGrid(database, body.periodId));
      }

      const result = await publishPeriod(database, body.periodId, user.id);
      return NextResponse.json({
        ...(await getRosterGrid(database, body.periodId)),
        published: result.published,
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
