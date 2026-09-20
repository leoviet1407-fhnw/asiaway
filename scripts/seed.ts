/**
 * Demo / development seed.
 *
 *   npm run seed
 *
 * Creates DEMO data only: three test tables and one test waiter account, plus
 * the real menu from the supplied CSV.
 *
 * It deliberately does NOT invent the restaurant's real table list, drinks or
 * staff. Those are supplied later; until then everything here is labelled DEMO.
 * Running it against a production database is refused unless SEED_ALLOW_PROD is
 * set explicitly.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresDatabase, type AppDatabase } from '../src/server/db/client';
import { applyMigrations, createPgliteDatabase } from '../src/server/db/pglite';
import {
  allergens,
  menuCategories,
  menuItems,
  restaurantTables,
  users,
} from '../src/server/db/schema';
import { parseMenuCsv } from '../src/server/menu/import';
import { ALLERGENS } from '../src/domain/menu/allergens';
import { generateQrToken, qrUrlFor } from '../src/domain/session/qr-token';
import { hashPassword } from '../src/server/auth/password';

const DEMO_TABLES = [
  { tableNumber: '01', displayName: 'Table 01 (DEMO)' },
  { tableNumber: '02', displayName: 'Table 02 (DEMO)' },
  { tableNumber: '03', displayName: 'Table 03 (DEMO)' },
];

const DEMO_WAITER = {
  email: 'waiter@asiaway.test',
  displayName: 'Demo Waiter',
  password: process.env.SEED_WAITER_PASSWORD ?? 'asiaway-demo-2026',
};

async function seedMenu(db: AppDatabase): Promise<number> {
  const csv = readFileSync(resolve(process.cwd(), 'data/menu_trilingual_EN_DE_VI.csv'), 'utf8');
  const menu = parseMenuCsv(csv);

  for (const a of ALLERGENS) {
    await db
      .insert(allergens)
      .values({ code: a.code, nameEn: a.nameEn, nameDe: a.nameDe, nameVi: a.nameVi })
      .onConflictDoUpdate({
        target: allergens.code,
        set: { nameEn: a.nameEn, nameDe: a.nameDe, nameVi: a.nameVi },
      });
  }

  const categoryIds = new Map<string, string>();
  for (const c of menu.categories) {
    const [row] = await db
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
        set: { nameEn: c.nameEn, nameDe: c.nameDe, nameVi: c.nameVi, sortOrder: c.sortOrder },
      })
      .returning({ id: menuCategories.id });
    categoryIds.set(c.slug, row!.id);
  }

  for (const item of menu.items) {
    await db
      .insert(menuItems)
      .values({
        categoryId: categoryIds.get(item.categorySlug)!,
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
          dishNumber: item.dishNumber,
          nameEn: item.nameEn,
          nameDe: item.nameDe,
          nameVi: item.nameVi,
          priceCents: item.priceCents,
          allergenCodes: [...item.allergenCodes],
          sortOrder: item.sortOrder,
          isActive: true,
        },
      });
  }

  return menu.items.length;
}

async function seedTables(db: AppDatabase, baseUrl: string) {
  const created: { tableNumber: string; url: string }[] = [];

  for (const table of DEMO_TABLES) {
    const existing = await db
      .select()
      .from(restaurantTables)
      .where(eq(restaurantTables.tableNumber, table.tableNumber));

    if (existing[0]) {
      created.push({ tableNumber: table.tableNumber, url: qrUrlFor(baseUrl, existing[0].qrToken) });
      continue;
    }

    const token = generateQrToken();
    await db.insert(restaurantTables).values({ ...table, qrToken: token });
    created.push({ tableNumber: table.tableNumber, url: qrUrlFor(baseUrl, token) });
  }

  return created;
}

async function seedWaiter(db: AppDatabase): Promise<boolean> {
  const existing = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${DEMO_WAITER.email}`);
  if (existing[0]) return false;

  await db.insert(users).values({
    email: DEMO_WAITER.email,
    displayName: DEMO_WAITER.displayName,
    passwordHash: await hashPassword(DEMO_WAITER.password),
    role: 'WAITER',
  });
  return true;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

  if (url && !process.env.SEED_ALLOW_PROD) {
    console.error(
      '\nRefusing to seed DEMO data into the database at DATABASE_URL.\n' +
        'This creates a test waiter account with a known password.\n' +
        'Set SEED_ALLOW_PROD=1 if this really is a demo or staging database.\n',
    );
    process.exitCode = 1;
    return;
  }

  let db: AppDatabase;
  let close: () => Promise<void> = async () => {};

  if (url) {
    const created = createPostgresDatabase(url);
    db = created.db;
    close = async () => {
      await created.client.end();
    };
  } else {
    mkdirSync(resolve(process.cwd(), '.pglite'), { recursive: true });
    const client = new PGlite(resolve(process.cwd(), '.pglite/asiaway'));
    const has = await client.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_name = 'orders'",
    );
    if ((has.rows[0]?.n ?? 0) === 0) await applyMigrations(client);
    db = createPgliteDatabase(client).db;
    close = async () => client.close();
  }

  const itemCount = await seedMenu(db);
  const tables = await seedTables(db, baseUrl);
  const waiterCreated = await seedWaiter(db);

  console.log('\nSeed complete');
  console.log('=============');
  console.log(`Menu items      : ${itemCount}`);
  console.log(`Demo tables     : ${tables.length}`);
  console.log(`Waiter account  : ${waiterCreated ? 'created' : 'already existed'}`);
  console.log(`\n  ${DEMO_WAITER.email} / ${DEMO_WAITER.password}   (DEMO ONLY)\n`);
  console.log('Table QR links (open on a phone, or generate printable codes with `npm run qr`):');
  for (const table of tables) console.log(`  Table ${table.tableNumber}  ${table.url}`);
  console.log('');

  await close();
}

main().catch((error: unknown) => {
  console.error('\nSeed FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
