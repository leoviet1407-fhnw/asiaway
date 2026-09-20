import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import {
  MAX_IMAGE_BYTES,
  listUpcomingSpecials,
  saveWeeklySpecial,
} from '../../../../server/services/specials-service';
import { nextSaturday, restaurantDate } from '../../../../domain/menu/saturday';
import { apiError, handleApiError, withWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The Saturdays already prepared, plus which one the screen should offer. */
export async function GET() {
  try {
    return (await withWaiter(async () => {
      const today = restaurantDate();
      const specials = await listUpcomingSpecials(await db(), today);
      return NextResponse.json({
        today,
        suggestedDate: nextSaturday(today),
        maxImageBytes: MAX_IMAGE_BYTES,
        specials,
      });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}

const Fields = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nameEn: z.string().min(1).max(120),
  nameDe: z.string().min(1).max(120),
  nameVi: z.string().min(1).max(120),
  descriptionEn: z.string().max(600).optional(),
  descriptionDe: z.string().max(600).optional(),
  descriptionVi: z.string().max(600).optional(),
});

/**
 * Sets, or corrects, the dish for one Saturday.
 *
 * Multipart rather than JSON because a photograph base64-encoded into JSON is a
 * third larger for no benefit. The photo is optional on a correction: fixing a
 * spelling should not mean finding the picture again.
 */
export async function POST(request: Request) {
  try {
    return (await withWaiter(async (user) => {
      const form = await request.formData().catch(() => null);
      if (!form) return apiError('VALIDATION_FAILED', 'The upload could not be read');

      const parsed = Fields.safeParse({
        serviceDate: form.get('serviceDate'),
        nameEn: form.get('nameEn'),
        nameDe: form.get('nameDe'),
        nameVi: form.get('nameVi'),
        descriptionEn: form.get('descriptionEn') ?? undefined,
        descriptionDe: form.get('descriptionDe') ?? undefined,
        descriptionVi: form.get('descriptionVi') ?? undefined,
      });
      if (!parsed.success) {
        return apiError('VALIDATION_FAILED', 'The dish needs a date and a name in all three languages');
      }

      const file = form.get('image');
      let image: { data: Buffer; mime: string } | null = null;

      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_IMAGE_BYTES) {
          return apiError('VALIDATION_FAILED', 'That photo is too large', {
            bytes: file.size,
            maxBytes: MAX_IMAGE_BYTES,
          });
        }
        image = { data: Buffer.from(await file.arrayBuffer()), mime: file.type };
      }

      const saved = await saveWeeklySpecial(await db(), {
        ...parsed.data,
        image,
        userId: user.id,
      });

      return NextResponse.json(saved, { status: 201 });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
