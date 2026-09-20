import { menuCategories, menuItems } from '../db/schema';
import type { AppDatabase } from '../db/client';
import { SATURDAY_CATEGORY, SATURDAY_ITEMS, SATURDAY_WEEKDAYS } from './saturday-menu';

/**
 * Puts the Saturday category and its two dishes on the menu.
 *
 * Idempotent, matching on `external_key` exactly as the CSV importers do, so it
 * is safe to run on every provisioning pass. Availability is deliberately not
 * reset: re-running this must never put a dish the kitchen marked sold out back
 * on sale.
 *
 * Allergens are left empty on purpose — see the note in saturday-menu.ts.
 */
export async function provisionSaturdayMenu(
  db: AppDatabase,
): Promise<{ categoryId: string; itemsApplied: number }> {
  const [category] = await db
    .insert(menuCategories)
    .values({
      slug: SATURDAY_CATEGORY.slug,
      kind: SATURDAY_CATEGORY.kind,
      nameEn: SATURDAY_CATEGORY.nameEn,
      nameDe: SATURDAY_CATEGORY.nameDe,
      nameVi: SATURDAY_CATEGORY.nameVi,
      sortOrder: SATURDAY_CATEGORY.sortOrder,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: menuCategories.slug,
      set: {
        kind: SATURDAY_CATEGORY.kind,
        nameEn: SATURDAY_CATEGORY.nameEn,
        nameDe: SATURDAY_CATEGORY.nameDe,
        nameVi: SATURDAY_CATEGORY.nameVi,
        sortOrder: SATURDAY_CATEGORY.sortOrder,
        isActive: true,
      },
    })
    .returning({ id: menuCategories.id });

  let itemsApplied = 0;
  for (const item of SATURDAY_ITEMS) {
    const values = {
      categoryId: category!.id,
      externalKey: item.externalKey,
      dishNumber: null,
      nameEn: item.nameEn,
      nameDe: item.nameDe,
      nameVi: item.nameVi,
      descriptionEn: item.descriptionEn,
      descriptionDe: item.descriptionDe,
      descriptionVi: item.descriptionVi,
      priceCents: item.priceCents,
      availableWeekdays: SATURDAY_WEEKDAYS,
      sortOrder: item.sortOrder,
    };

    await db
      .insert(menuItems)
      .values(values)
      .onConflictDoUpdate({
        target: menuItems.externalKey,
        set: {
          categoryId: values.categoryId,
          nameEn: values.nameEn,
          nameDe: values.nameDe,
          nameVi: values.nameVi,
          priceCents: values.priceCents,
          availableWeekdays: values.availableWeekdays,
          sortOrder: values.sortOrder,
          isActive: true,
          updatedAt: new Date(),
          // Descriptions and allergens are NOT overwritten: once the restaurant
          // fills them in, a later provisioning run must not wipe them back to
          // the empty placeholders in this file.
        },
      });
    itemsApplied += 1;
  }

  return { categoryId: category!.id, itemsApplied };
}
