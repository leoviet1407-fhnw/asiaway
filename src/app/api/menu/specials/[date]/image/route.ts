import { db } from '../../../../../../server/db/index';
import { getSpecialImage } from '../../../../../../server/services/specials-service';
import { isSaturdayDate } from '../../../../../../domain/menu/saturday';
import { handleApiError } from '../../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * This week's dish photograph, served from the database.
 *
 * Public, like the rest of the menu: a guest has to see it before any order
 * exists. The URL carries the photo's own hash as `?v=`, so a replaced picture
 * gets a new URL and the long cache below can never serve last week's dish.
 */
export async function GET(request: Request, context: { params: Promise<{ date: string }> }) {
  try {
    const { date } = await context.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isSaturdayDate(date)) {
      return new Response('Not found', { status: 404 });
    }

    const image = await getSpecialImage(await db(), date);
    if (!image) return new Response('Not found', { status: 404 });

    // A phone that already has this exact photo re-downloads nothing.
    if (request.headers.get('if-none-match') === `"${image.etag}"`) {
      return new Response(null, { status: 304, headers: { ETag: `"${image.etag}"` } });
    }

    return new Response(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.mime,
        'Content-Length': String(image.data.length),
        ETag: `"${image.etag}"`,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
