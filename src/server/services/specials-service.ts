import { createHash } from 'node:crypto';
import { desc, eq, gte } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isSaturdayDate, restaurantDate } from '../../domain/menu/saturday';
import { auditEvents, menuItems, weeklySpecials } from '../db/schema';
import { SATURDAY_SPECIAL_KEY } from '../menu/saturday-menu';
import type { Db } from './order-service';

/**
 * Photographs go into the database, so a size limit is a real constraint rather
 * than a formality. The upload screen downscales before sending; this is the
 * backstop for anything that does not.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface WeeklySpecialInput {
  serviceDate: string;
  nameEn: string;
  nameDe: string;
  nameVi: string;
  descriptionEn?: string;
  descriptionDe?: string;
  descriptionVi?: string;
  image: { data: Buffer; mime: string } | null;
  userId: string;
}

export interface WeeklySpecialSummary {
  id: string;
  serviceDate: string;
  nameEn: string;
  nameDe: string;
  nameVi: string;
  descriptionEn: string;
  descriptionDe: string;
  descriptionVi: string;
  imageEtag: string;
  imageBytes: number;
  updatedAt: string;
}

/**
 * Saves the dish for one Saturday.
 *
 * Re-saving the same date replaces it, because staff will get a name wrong or
 * pick the wrong photo and need to fix it. Leaving `image` null on an existing
 * row keeps the photo already there, so correcting a spelling does not mean
 * finding the picture again.
 */
export async function saveWeeklySpecial(
  db: Db,
  input: WeeklySpecialInput,
): Promise<WeeklySpecialSummary> {
  if (!isSaturdayDate(input.serviceDate)) {
    throw domainError('VALIDATION_FAILED', 'The special dish runs on Saturdays', {
      serviceDate: input.serviceDate,
    });
  }

  const names = [input.nameEn, input.nameDe, input.nameVi].map((n) => n.trim());
  if (names.some((n) => n.length === 0)) {
    // All three or none. A half-translated menu is worse than an obviously
    // untranslated one, because a guest cannot tell which name they are
    // missing.
    throw domainError('VALIDATION_FAILED', 'The dish needs a name in all three languages');
  }

  if (input.image) {
    if (!ALLOWED_MIME.has(input.image.mime)) {
      throw domainError('VALIDATION_FAILED', 'The photo must be a JPEG, PNG or WebP');
    }
    if (input.image.data.length > MAX_IMAGE_BYTES) {
      throw domainError('VALIDATION_FAILED', 'That photo is too large', {
        bytes: input.image.data.length,
        maxBytes: MAX_IMAGE_BYTES,
      });
    }
    if (input.image.data.length === 0) {
      throw domainError('VALIDATION_FAILED', 'That photo is empty');
    }
  }

  return db.transaction(async (tx: Db) => {
    const [item] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(eq(menuItems.externalKey, SATURDAY_SPECIAL_KEY));

    if (!item) {
      throw domainError(
        'VALIDATION_FAILED',
        'The Saturday special dish is not set up on this menu yet',
      );
    }

    const [existing] = await tx
      .select()
      .from(weeklySpecials)
      .where(eq(weeklySpecials.serviceDate, input.serviceDate));

    if (!input.image && !existing) {
      // There is nothing to show without one, and showing last week's photo
      // beside this week's name would be worse than showing nothing.
      throw domainError('VALIDATION_FAILED', 'This Saturday needs a photo of the dish');
    }

    const image = input.image
      ? { data: input.image.data, mime: input.image.mime, etag: etagFor(input.image.data) }
      : { data: existing!.imageData, mime: existing!.imageMime, etag: existing!.imageEtag };

    const values = {
      serviceDate: input.serviceDate,
      menuItemId: item.id,
      nameEn: names[0]!,
      nameDe: names[1]!,
      nameVi: names[2]!,
      descriptionEn: (input.descriptionEn ?? '').trim(),
      descriptionDe: (input.descriptionDe ?? '').trim(),
      descriptionVi: (input.descriptionVi ?? '').trim(),
      imageData: image.data,
      imageMime: image.mime,
      imageEtag: image.etag,
      createdBy: input.userId,
      updatedAt: new Date(),
    };

    const [row] = await tx
      .insert(weeklySpecials)
      .values(values)
      .onConflictDoUpdate({ target: weeklySpecials.serviceDate, set: values })
      .returning();

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: input.userId,
      action: existing ? 'SATURDAY_SPECIAL_UPDATED' : 'SATURDAY_SPECIAL_SET',
      entityType: 'MENU_ITEM',
      entityId: row!.id,
      beforeValue: existing ? { nameEn: existing.nameEn, imageEtag: existing.imageEtag } : null,
      afterValue: { nameEn: row!.nameEn, imageEtag: row!.imageEtag },
      metadata: {
        serviceDate: input.serviceDate,
        photoReplaced: Boolean(input.image),
        imageBytes: image.data.length,
      },
    });

    return toSummary(row!);
  });
}

/**
 * This Saturday's dish, or nothing.
 *
 * Nothing is the honest answer when no row exists: the dish that week is
 * whatever the kitchen decided, and the app has not been told.
 */
export async function getSpecialForDate(
  db: Db,
  serviceDate: string,
): Promise<WeeklySpecialSummary | null> {
  const [row] = await db
    .select()
    .from(weeklySpecials)
    .where(eq(weeklySpecials.serviceDate, serviceDate));
  return row ? toSummary(row) : null;
}

/** The photo bytes for one Saturday, for the image route to serve. */
export async function getSpecialImage(
  db: Db,
  serviceDate: string,
): Promise<{ data: Buffer; mime: string; etag: string } | null> {
  const [row] = await db
    .select({
      data: weeklySpecials.imageData,
      mime: weeklySpecials.imageMime,
      etag: weeklySpecials.imageEtag,
    })
    .from(weeklySpecials)
    .where(eq(weeklySpecials.serviceDate, serviceDate));

  return row ? { data: Buffer.from(row.data), mime: row.mime, etag: row.etag } : null;
}

/**
 * The Saturdays already prepared, most recent first — what the upload screen
 * shows so staff can see at a glance whether this week is done.
 */
export async function listUpcomingSpecials(
  db: Db,
  from: string = restaurantDate(),
  limit = 12,
): Promise<WeeklySpecialSummary[]> {
  const rows = await db
    .select()
    .from(weeklySpecials)
    .where(gte(weeklySpecials.serviceDate, from))
    .orderBy(desc(weeklySpecials.serviceDate))
    .limit(limit);
  return rows.map(toSummary);
}

function toSummary(row: typeof weeklySpecials.$inferSelect): WeeklySpecialSummary {
  return {
    id: row.id,
    serviceDate: row.serviceDate,
    nameEn: row.nameEn,
    nameDe: row.nameDe,
    nameVi: row.nameVi,
    descriptionEn: row.descriptionEn,
    descriptionDe: row.descriptionDe,
    descriptionVi: row.descriptionVi,
    imageEtag: row.imageEtag,
    imageBytes: row.imageData.length,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Content-addressed, so replacing the photo changes the URL's validator. */
function etagFor(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}
