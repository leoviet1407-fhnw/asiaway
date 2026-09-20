import { and, asc, eq } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import type { Locale } from '../../i18n/locales';
import { allergens, auditEvents, menuCategories, menuItems } from '../db/schema';
import type { Db } from './order-service';

export interface LocalisedMenuItem {
  readonly id: string;
  readonly dishNumber: string | null;
  readonly volume: string | null;
  readonly name: string;
  readonly description: string;
  readonly priceCents: number;
  readonly allergenCodes: string[];
  readonly imagePath: string | null;
  readonly isAvailable: boolean;
}

export interface LocalisedCategory {
  readonly id: string;
  readonly slug: string;
  readonly kind: 'FOOD' | 'DRINK';
  readonly name: string;
  readonly items: LocalisedMenuItem[];
}

function pick<T extends Record<string, unknown>>(row: T, base: string, locale: Locale): string {
  const key = `${base}${locale === 'en' ? 'En' : locale === 'de' ? 'De' : 'Vi'}`;
  return String(row[key] ?? '');
}

/**
 * The customer menu, already localised.
 *
 * Sold-out items are RETURNED, not filtered out: the guest must still see the
 * dish and that it is unavailable today (spec §13). Availability shown here is
 * advisory — it is re-checked inside the submit transaction, which is what
 * actually decides.
 */
export async function getMenu(db: Db, locale: Locale): Promise<LocalisedCategory[]> {
  const categories = await db
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.isActive, true))
    .orderBy(asc(menuCategories.kind), asc(menuCategories.sortOrder));

  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.isActive, true))
    .orderBy(asc(menuItems.sortOrder));

  return categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    kind: category.kind,
    name: pick(category, 'name', locale),
    items: items
      .filter((item) => item.categoryId === category.id)
      .map((item) => ({
        id: item.id,
        dishNumber: item.dishNumber,
        volume: item.volume,
        name: pick(item, 'name', locale),
        description: pick(item, 'description', locale),
        priceCents: item.priceCents,
        allergenCodes: item.allergenCodes,
        imagePath: item.imagePath,
        isAvailable: item.isAvailable,
      })),
  }));
}

export async function getMenuItem(
  db: Db,
  id: string,
  locale: Locale,
): Promise<LocalisedMenuItem & { categoryName: string }> {
  const rows = await db
    .select({ item: menuItems, category: menuCategories })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(and(eq(menuItems.id, id), eq(menuItems.isActive, true)));

  const row = rows[0];
  if (!row) throw domainError('VALIDATION_FAILED', 'Menu item not found', { id });

  return {
    id: row.item.id,
    dishNumber: row.item.dishNumber,
    volume: row.item.volume,
    name: pick(row.item, 'name', locale),
    description: pick(row.item, 'description', locale),
    priceCents: row.item.priceCents,
    allergenCodes: row.item.allergenCodes,
    imagePath: row.item.imagePath,
    isAvailable: row.item.isAvailable,
    categoryName: pick(row.category, 'name', locale),
  };
}

export async function getAllergenLegend(db: Db, locale: Locale) {
  const rows = await db.select().from(allergens).orderBy(asc(allergens.code));
  return rows.map((row) => ({ code: row.code, name: pick(row, 'name', locale) }));
}

/**
 * Sold-out toggle. Takes effect immediately for every guest — it is a data
 * change, never a deployment.
 */
export async function setAvailability(
  db: Db,
  input: { menuItemId: string; isAvailable: boolean; userId: string; reason?: string | null },
): Promise<{ isAvailable: boolean }> {
  return db.transaction(async (tx: Db) => {
    const [item] = await tx.select().from(menuItems).where(eq(menuItems.id, input.menuItemId));
    if (!item) throw domainError('VALIDATION_FAILED', 'Menu item not found');

    if (item.isAvailable === input.isAvailable) {
      return { isAvailable: item.isAvailable };
    }

    const changedAt = new Date();
    await tx
      .update(menuItems)
      .set({
        isAvailable: input.isAvailable,
        availabilityChangedAt: changedAt,
        availabilityChangedBy: input.userId,
        updatedAt: changedAt,
      })
      .where(eq(menuItems.id, item.id));

    await tx.insert(auditEvents).values({
      actorType: 'WAITER',
      actorUserId: input.userId,
      action: input.isAvailable ? 'MENU_ITEM_RESTORED' : 'MENU_ITEM_SOLD_OUT',
      entityType: 'MENU_ITEM',
      entityId: item.id,
      beforeValue: { isAvailable: item.isAvailable },
      afterValue: { isAvailable: input.isAvailable },
      metadata: { nameEn: item.nameEn, dishNumber: item.dishNumber, reason: input.reason ?? null },
    });

    return { isAvailable: input.isAvailable };
  });
}

/** The waiter's availability screen: every item, both kinds, with its state. */
export async function getAvailabilityList(db: Db) {
  return db
    .select({
      id: menuItems.id,
      dishNumber: menuItems.dishNumber,
      volume: menuItems.volume,
      nameEn: menuItems.nameEn,
      nameDe: menuItems.nameDe,
      nameVi: menuItems.nameVi,
      priceCents: menuItems.priceCents,
      isAvailable: menuItems.isAvailable,
      categoryName: menuCategories.nameEn,
      categorySort: menuCategories.sortOrder,
      sortOrder: menuItems.sortOrder,
    })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(eq(menuItems.isActive, true))
    .orderBy(asc(menuCategories.sortOrder), asc(menuItems.sortOrder));
}
