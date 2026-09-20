import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../../../server/db/index';
import { closeIdleSessions } from '../../../../server/services/session-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Closes dining sessions that have been idle too long.
 *
 * This guards the worst failure mode in the system: a party leaves without
 * asking for the bill, and the next guests scanning that table inherit their
 * open session and their orders.
 *
 * Run it on a schedule — Vercel Cron, a host cron, or any scheduler that can
 * make an authenticated request. It is idempotent, so running it often is
 * harmless and missing a run only delays the cleanup.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!secret) {
    // Without a configured secret the endpoint is refused rather than left
    // open: an unauthenticated route that closes tables would be a gift.
    return false;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Not authorised' } },
      { status: 401 },
    );
  }

  try {
    const idleHours = Number(process.env.SESSION_IDLE_TIMEOUT_HOURS ?? 4);
    const closed = await closeIdleSessions(await db(), idleHours);
    return NextResponse.json({ closed, idleHours });
  } catch (error) {
    console.error('[cron] close-idle-sessions failed', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Cleanup failed' } },
      { status: 500 },
    );
  }
}
