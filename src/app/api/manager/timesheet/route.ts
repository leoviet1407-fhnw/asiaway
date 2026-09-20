import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import {
  approveEntry,
  correctEntry,
  listPendingEntries,
  listRevisions,
  recordEntry,
} from '../../../../server/services/timesheet-service';
import { apiError, handleApiError, withManager } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything still waiting on a manager, plus one entry's history on request. */
export async function GET(request: Request) {
  try {
    return (await withManager(async () => {
      const entryId = new URL(request.url).searchParams.get('entry');
      const database = await db();
      if (entryId) {
        return NextResponse.json({ revisions: await listRevisions(database, entryId) });
      }
      return NextResponse.json({ pending: await listPendingEntries(database) });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const ISO = z.string().datetime();
const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), entryId: z.string().uuid() }),
  z.object({
    action: z.literal('correct'),
    entryId: z.string().uuid(),
    clockInAt: ISO.optional(),
    clockOutAt: ISO.optional(),
    breakMinutes: z.number().int().min(0).max(600).optional(),
    reason: z.string().min(1).max(280),
  }),
  z.object({
    action: z.literal('record'),
    userId: z.string().uuid(),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clockInAt: ISO,
    clockOutAt: ISO,
    breakMinutes: z.number().int().min(0).max(600),
    note: z.string().max(280).optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    return (await withManager(async (manager) => {
      const parsed = Action.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'That action was not understood');

      const database = await db();
      const body = parsed.data;

      if (body.action === 'approve') {
        await approveEntry(database, body.entryId, manager.id);
      } else if (body.action === 'correct') {
        await correctEntry(
          database,
          body.entryId,
          {
            clockInAt: body.clockInAt ? new Date(body.clockInAt) : undefined,
            clockOutAt: body.clockOutAt ? new Date(body.clockOutAt) : undefined,
            breakMinutes: body.breakMinutes,
          },
          manager.id,
          body.reason,
        );
      } else {
        await recordEntry(
          database,
          {
            userId: body.userId,
            businessDate: body.businessDate,
            clockInAt: new Date(body.clockInAt),
            clockOutAt: new Date(body.clockOutAt),
            breakMinutes: body.breakMinutes,
            note: body.note ?? null,
          },
          manager.id,
        );
      }

      return NextResponse.json({ pending: await listPendingEntries(database) });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
