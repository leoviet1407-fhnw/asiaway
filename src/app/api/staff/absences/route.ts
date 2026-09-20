import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import {
  ABSENCE_TYPES,
  listAbsencesFor,
  requestAbsence,
} from '../../../../server/services/period-service';
import { apiError, handleApiError, withStaffMember } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return (await withStaffMember(async (user) =>
      NextResponse.json({ absences: await listAbsencesFor(await db(), user.id) }),
    )) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const Body = z.object({
  startsOn: z.string().regex(DATE),
  endsOn: z.string().regex(DATE),
  absenceType: z.enum(ABSENCE_TYPES),
  note: z.string().max(280).optional(),
});

/** Always the caller's own leave; the user id comes from the session. */
export async function POST(request: Request) {
  try {
    return (await withStaffMember(async (user) => {
      const parsed = Body.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'That request could not be read');

      const database = await db();
      await requestAbsence(database, { userId: user.id, ...parsed.data });
      return NextResponse.json({ absences: await listAbsencesFor(database, user.id) });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
