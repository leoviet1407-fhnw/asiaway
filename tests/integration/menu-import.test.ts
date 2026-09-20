import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import { allergens, auditEvents, menuCategories, menuItems } from '../../src/server/db/schema';
import { parseMenuCsv } from '../../src/server/menu/import';
import { ALLERGENS } from '../../src/domain/menu/allergens';
import type { AppDatabase } from '../../src/server/db/client';

// The importer's write half, mirroring scripts/import-menu.ts.
async function applyToDatabase(db: AppDatabase, menu: ReturnType<typeof parseMenuCsv>) {
  await db.transaction(async (tx: AppDatabase) => {
    for (const a of ALLERGENS) {
      await tx
        .insert(allergens)
        .values({ code: a.code, nameEn: a.nameEn, nameDe: a.nameDe, nameVi: a.nameVi })
        .onConflictDoUpdate({
          target: allergens.code,
          set: { nameEn: a.nameEn, nameDe: a.nameDe, nameVi: a.nameVi },
        });
    }

    const categoryIds = new Map<string, string>();
    for (const c of menu.categories) {
      const [row] = await tx
        .insert(menuCategories)
        .values({
          slug: c.slug,
          kind: c.kind,
          nameEn: c.nameEn,
          nameDe: c.nameDe,
          nameVi: c.nameVi,
          sortOrder: c.sortOrder,
        })
        .onConflictDoUpdate({
          target: menuCategories.slug,
          set: { nameEn: c.nameEn, sortOrder: c.sortOrder, isActive: true },
        })
        .returning({ id: menuCategories.id });
      categoryIds.set(c.slug, row!.id);
    }

    for (const item of menu.items) {
      const categoryId = categoryIds.get(item.categorySlug)!;
      await tx
        .insert(menuItems)
        .values({
          categoryId,
          externalKey: item.externalKey,
          dishNumber: item.dishNumber,
          nameEn: item.nameEn,
          nameDe: item.nameDe,
          nameVi: item.nameVi,
          descriptionEn: item.descriptionEn,
          descriptionDe: item.descriptionDe,
          descriptionVi: item.descriptionVi,
          priceCents: item.priceCents,
          allergenCodes: [...item.allergenCodes],
          sortOrder: item.sortOrder,
        })
        .onConflictDoUpdate({
          target: menuItems.externalKey,
          set: {
            nameEn: item.nameEn,
            priceCents: item.priceCents,
            allergenCodes: [...item.allergenCodes],
            sortOrder: item.sortOrder,
            isActive: true,
            updatedAt: new Date(),
          },
        });
    }

    await tx.insert(auditEvents).values({
      actorType: 'SYSTEM',
      action: 'MENU_IMPORTED',
      entityType: 'MENU_ITEM',
      entityId: '00000000-0000-0000-0000-000000000000',
      metadata: { itemsProduced: menu.stats.itemsProduced },
    });
  });
}

let ctx: TestContext;
let db: AppDatabase;
const csv = readFileSync(resolve(process.cwd(), 'data/menu_trilingual_EN_DE_VI.csv'), 'utf8');

beforeAll(async () => {
  ctx = await createTestDatabase();
  db = ctx.db as unknown as AppDatabase;
  await applyToDatabase(db, parseMenuCsv(csv));
});

afterAll(async () => {
  await ctx.close();
});

const countItems = async () => {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(menuItems);
  return row!.n;
};

describe('menu import against a real database', () => {
  it('writes all 56 items and 5 food categories', async () => {
    expect(await countItems()).toBe(56);
    const cats = await db.select().from(menuCategories);
    expect(cats).toHaveLength(5);
    expect(cats.every((c) => c.kind === 'FOOD')).toBe(true);
  });

  it('seeds the full 14-code allergen legend including G = Milk (decision E2)', async () => {
    const rows = await db.select().from(allergens);
    expect(rows).toHaveLength(14);
    const g = rows.find((r) => r.code === 'G')!;
    expect(g.nameDe).toBe('Milch');
    expect(g.nameEn).toBe('Milk');
  });

  it('stores prices as integer Rappen', async () => {
    const [pho] = await db.select().from(menuItems).where(eq(menuItems.dishNumber, '40'));
    expect(pho!.priceCents).toBe(2450);
    expect(Number.isInteger(pho!.priceCents)).toBe(true);
  });

  it('records the import in the audit trail', async () => {
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, 'MENU_IMPORTED'));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe('SYSTEM');
  });

  it('leaves image_path null rather than inventing a photo', async () => {
    const withImages = await db.select().from(menuItems).where(sql`${menuItems.imagePath} is not null`);
    expect(withImages).toHaveLength(0);
  });

  it('holds no drinks, because the drinks menu has not been supplied', async () => {
    const drinks = await db.select().from(menuCategories).where(eq(menuCategories.kind, 'DRINK'));
    expect(drinks).toHaveLength(0);
  });

  it('is idempotent: a second import updates in place and adds nothing', async () => {
    await applyToDatabase(db, parseMenuCsv(csv));
    expect(await countItems()).toBe(56);
  });

  it('does not put a sold-out dish back on sale on re-import', async () => {
    const [item] = await db.select().from(menuItems).where(eq(menuItems.dishNumber, '90.1'));
    await db
      .update(menuItems)
      .set({ isAvailable: false, availabilityChangedAt: new Date() })
      .where(eq(menuItems.id, item!.id));

    await applyToDatabase(db, parseMenuCsv(csv));

    const [after] = await db.select().from(menuItems).where(eq(menuItems.id, item!.id));
    expect(after!.isAvailable).toBe(false);
  });

  it('applies a price change from an updated CSV', async () => {
    // Target the n 40 line specifically: appetizer n 23 is also 24.50 with
    // allergens "D F", so a naive replace would edit the wrong dish.
    const updated = csv
      .split('\n')
      .map((line) =>
        line.startsWith('Noodle Soup,40,') ? line.replace(',24.5,D F', ',26.5,D F') : line,
      )
      .join('\n');
    expect(updated).not.toBe(csv);

    await applyToDatabase(db, parseMenuCsv(updated));
    const [pho] = await db.select().from(menuItems).where(eq(menuItems.dishNumber, '40'));
    expect(pho!.priceCents).toBe(2650);

    await applyToDatabase(db, parseMenuCsv(csv)); // restore
  });
});
