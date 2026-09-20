import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import { decideAbsence, listPendingAbsences } from '../../../../server/services/period-service';
import { apiError, handleApiError, withManager } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return (await withManager(async () =>
      NextResponse.json({ pending: await listPendingAbsences(await db()) }),
    )) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const Body = z.object({
  absenceId: z.string().uuid(),
  decision: z.enum(['APPROVED', 'REJECTED']),
});

export async function POST(request: Request) {
  try {
    return (await withManager(async (manager) => {
      const parsed = Body.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'That decision was not understood');

      const database = await db();
      await decideAbsence(database, parsed.data.absenceId, parsed.data.decision, manager.id);
      return NextResponse.json({ pending: await listPendingAbsences(database) });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
