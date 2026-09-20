import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../../../server/db/index';
import { availability, users } from '../../../../server/db/schema';
import {
  clearDayAvailability,
  setDayAvailability,
} from '../../../../server/services/availability-service';
import { apiError, handleApiError, withManager } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Availability a manager records for someone else.
 *
 * Needed because generating a month closes it to staff, and an Aushilfe who
 * offers hours after that cannot otherwise be rostered at all — their
 * availability is the only thing that puts them on the plan. Every write here
 * is audited against the manager who made it.
 */
export async function GET(request: Request) {
  try {
    return (await withManager(async () => {
      const params = new URL(request.url).searchParams;
      const from = params.get('from');
      const to = params.get('to');
      if (!from || !to) return apiError('VALIDATION_FAILED', 'A date range is required');

      const rows = await (await db())
        .select({
          userId: availability.userId,
          displayName: users.displayName,
          onDate: availability.onDate,
          fromTime: availability.fromTime,
          toTime: availability.toTime,
          kind: availability.kind,
        })
        .from(availability)
        .innerJoin(users, eq(users.id, availability.userId))
        .where(and(gte(availability.onDate, from), lte(availability.onDate, to)));

      return NextResponse.json({
        entries: rows.map((r) => ({ ...r, fromTime: r.fromTime.slice(0, 5), toTime: r.toTime.slice(0, 5) })),
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const TIME = /^\d{2}:\d{2}$/;
const Body = z
  .object({
    userId: z.string().uuid(),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(['AVAILABLE', 'PREFERRED', 'UNAVAILABLE', 'NONE']),
    fromTime: z.string().regex(TIME).optional(),
    toTime: z.string().regex(TIME).optional(),
    note: z.string().max(280).optional(),
  })
  .refine((b) => b.kind === 'UNAVAILABLE' || b.kind === 'NONE' || (b.fromTime && b.toTime), {
    message: 'A window needs both a start and an end',
  });

export async function PUT(request: Request) {
  try {
    return (await withManager(async (manager) => {
      const parsed = Body.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return apiError('VALIDATION_FAILED', 'That could not be saved as written');

      const { userId, onDate, kind, fromTime, toTime, note } = parsed.data;
      const database = await db();
      const actor = { kind: 'MANAGER' as const, managerId: manager.id };

      if (kind === 'NONE') {
        await clearDayAvailability(database, userId, onDate, actor);
      } else {
        await setDayAvailability(
          database,
          { userId, onDate, kind, fromTime, toTime, note: note ?? null },
          actor,
        );
      }
      return NextResponse.json({ ok: true });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
