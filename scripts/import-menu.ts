/**
 * Menu importer.
 *
 *   npm run menu:preview     -- parse + validate + report, write nothing
 *   npm run menu:import      -- apply to the database
 *
 * Re-running is safe: items are matched on their stable external key, so an
 * import updates in place rather than duplicating. Items that disappear from
 * the CSV are DEACTIVATED, never deleted, so historical orders still resolve.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresDatabase, type AppDatabase } from '../src/server/db/client';
import { applyMigrations, createPgliteDatabase } from '../src/server/db/pglite';
import { allergens, auditEvents, menuCategories, menuItems } from '../src/server/db/schema';
import { parseMenuCsv, type ImportedMenu } from '../src/server/menu/import';
import { ALLERGENS } from '../src/domain/menu/allergens';
import { formatCents } from '../src/lib/money';

const DEFAULT_CSV = 'data/menu_trilingual_EN_DE_VI.csv';

function report(menu: ImportedMenu): void {
  console.log('\nMenu import preview');
  console.log('===================');
  console.log(`CSV rows read       : ${menu.stats.csvRows}`);
  console.log(`Bundled rows split  : ${menu.stats.rowsSplit}`);
  console.log(`Orderable items     : ${menu.stats.itemsProduced}`);
  console.log(`Categories          : ${menu.categories.length} (all FOOD; no drinks supplied)\n`);

  for (const category of menu.categories) {
    const items = menu.items.filter((i) => i.categorySlug === category.slug);
    console.log(`${category.nameEn} (${items.length})`);
    for (const item of items) {
      const allergenText = item.allergenCodes.join(' ') || '-';
      console.log(
        `  n ${item.dishNumber.padEnd(6)} ${item.nameEn.padEnd(58)} ` +
          `${formatCents(item.priceCents).padStart(11)}  [${allergenText}]`,
      );
    }
    console.log('');
  }
}

async function applyToDatabase(db: AppDatabase, menu: ImportedMenu): Promise<void> {
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
          isActive: true,
        })
        .onConflictDoUpdate({
          target: menuCategories.slug,
          set: {
            kind: c.kind,
            nameEn: c.nameEn,
            nameDe: c.nameDe,
            nameVi: c.nameVi,
            sortOrder: c.sortOrder,
            isActive: true,
          },
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
          volume: item.volume ?? null,
          sortOrder: item.sortOrder,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: menuItems.externalKey,
          set: {
            categoryId,
            dishNumber: item.dishNumber,
            nameEn: item.nameEn,
            nameDe: item.nameDe,
            nameVi: item.nameVi,
            descriptionEn: item.descriptionEn,
            descriptionDe: item.descriptionDe,
            descriptionVi: item.descriptionVi,
            priceCents: item.priceCents,
            allergenCodes: [...item.allergenCodes],
            volume: item.volume ?? null,
            sortOrder: item.sortOrder,
            isActive: true,
            updatedAt: new Date(),
            // Availability is deliberately NOT reset: an import must not silently
            // put a dish the waiter marked sold out back on sale.
          },
        });
    }

    // Anything no longer in the CSV is retired, not removed.
    const keys = menu.items.map((i) => i.externalKey);
    await tx
      .update(menuItems)
      .set({ isActive: false, updatedAt: new Date() })
      .where(sql`${menuItems.externalKey} not in ${keys}`);

    await tx.insert(auditEvents).values({
      actorType: 'SYSTEM',
      action: 'MENU_IMPORTED',
      entityType: 'MENU_ITEM',
      entityId: '00000000-0000-0000-0000-000000000000',
      metadata: {
        csvRows: menu.stats.csvRows,
        itemsProduced: menu.stats.itemsProduced,
        rowsSplit: menu.stats.rowsSplit,
      },
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvArg = args.find((a) => a.startsWith('--csv='));
  const csvPath = resolve(process.cwd(), csvArg ? csvArg.slice('--csv='.length) : DEFAULT_CSV);

  const menu = parseMenuCsv(readFileSync(csvPath, 'utf8'));
  report(menu);

  if (dryRun) {
    console.log('Dry run: nothing written.\n');
    return;
  }

  const url = process.env.DATABASE_URL;
  if (url) {
    const { db, client } = createPostgresDatabase(url);
    await applyToDatabase(db, menu);
    await client.end();
    console.log(`Imported ${menu.items.length} items into ${url.replace(/:[^:@]*@/, ':***@')}\n`);
    return;
  }

  // No DATABASE_URL: run against an ephemeral in-process PostgreSQL so the
  // importer can be exercised end to end with no infrastructure.
  console.log('DATABASE_URL not set — running against an ephemeral in-process PostgreSQL.\n');
  const client = new PGlite();
  await applyMigrations(client);
  const { db } = createPgliteDatabase(client);
  await applyToDatabase(db, menu);

  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(menuItems)
    .where(eq(menuItems.isActive, true));
  console.log(`Verified in database: ${rows[0]?.count ?? 0} active menu items.\n`);
  await client.close();
}

main().catch((error: unknown) => {
  console.error('\nMenu import FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
