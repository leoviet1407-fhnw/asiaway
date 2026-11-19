import { db } from '@/server/db';
import { buildCalendar } from '@/server/services/calendar-service';

export const dynamic = 'force-dynamic';

/**
 * A person's shifts as a calendar feed: /kalender/<token>.ics
 * No login (calendar apps cannot log in); the long random token is the key.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ics = await buildCalendar(await db(), token.replace(/\.ics$/i, ''));
  if (!ics) return new Response('Not found', { status: 404 });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="asiaway-dienstplan.ics"',
      'Cache-Control': 'private, max-age=900',
    },
  });
}
