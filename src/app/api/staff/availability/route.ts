import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import {
  clearDayAvailability,
  getAvailabilityWorkspace,
  setDayAvailability,
} from '../../../../server/services/availability-service';
import { apiError, handleApiError, withStaffMember } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the availability screen needs for the month now being collected. */
export async function GET() {
  try {
    return (await withStaffMember(async (user) =>
      NextResponse.json(await getAvailabilityWorkspace(await db(), user.id)),
    )) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const TIME = /^\d{2}:\d{2}$/;

const Body = z
  .object({
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(['AVAILABLE', 'PREFERRED', 'UNAVAILABLE', 'NONE']),
    fromTime: z.string().regex(TIME).optional(),
    toTime: z.string().regex(TIME).optional(),
    note: z.string().max(280).optional(),
  })
  .refine((b) => b.kind === 'UNAVAILABLE' || b.kind === 'NONE' || (b.fromTime && b.toTime), {
    message: 'A window needs both a start and an end',
  });

/**
 * Records what one person says about one day.
 *
 * Always the caller's own availability: the user id comes from the session and
 * is never read from the body, so no employee can submit on another's behalf.
 * A manager correcting someone else's entry is a different screen with its own
 * audit trail, and belongs to B2.
 */
export async function PUT(request: Request) {
  try {
    return (await withStaffMember(async (user) => {
      const parsed = Body.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'That day could not be saved as written');
      }
      const { onDate, kind, fromTime, toTime, note } = parsed.data;
      const database = await db();

      if (kind === 'NONE') {
        await clearDayAvailability(database, user.id, onDate);
      } else {
        await setDayAvailability(database, {
          userId: user.id,
          onDate,
          kind,
          fromTime,
          toTime,
          note: note ?? null,
        });
      }

      return NextResponse.json(await getAvailabilityWorkspace(database, user.id));
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
