import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import {
  createMonth,
  listPeriods,
  setDeadline,
  setPeriodState,
  PERIOD_STATES,
} from '../../../../server/services/period-service';
import { apiError, handleApiError, withManager } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return (await withManager(async () =>
      NextResponse.json({ periods: await listPeriods(await db()) }),
    )) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const Action = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    firstDay: z.string().regex(/^\d{4}-\d{2}-01$/),
    deadline: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal('setState'),
    periodId: z.string().uuid(),
    state: z.enum(PERIOD_STATES),
  }),
  z.object({
    action: z.literal('setDeadline'),
    periodId: z.string().uuid(),
    deadline: z.string().nullable(),
  }),
]);

export async function POST(request: Request) {
  try {
    return (await withManager(async (manager) => {
      const parsed = Action.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'That action was not understood');

      const database = await db();
      const body = parsed.data;

      if (body.action === 'create') {
        await createMonth(database, body.firstDay, body.deadline ?? null, manager.id);
      } else if (body.action === 'setState') {
        await setPeriodState(database, body.periodId, body.state, manager.id);
      } else {
        await setDeadline(database, body.periodId, body.deadline);
      }

      return NextResponse.json({ periods: await listPeriods(database) });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
