import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, getDatabase } from '../../../../server/db/index';
import { runMigrations } from '../../../../server/db/migrator';
import {
  allergens,
  menuCategories,
  menuItems,
  restaurantTables,
  users,
} from '../../../../server/db/schema';
import { parseMenuCsv } from '../../../../server/menu/import';
import { parseDrinksCsv } from '../../../../server/menu/drinks-import';
import { ALLERGENS } from '../../../../domain/menu/allergens';
import { generateQrToken } from '../../../../domain/session/qr-token';
import { hashPassword } from '../../../../server/auth/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * One-time provisioning for a fresh deployment: create the schema, load the
 * menu, add the tables and the first staff account.
 *
 * Why this exists: a managed database hands its credentials to the deployment,
 * not to a laptop. Without this, standing up a new environment means someone
 * copying a production connection string onto their own machine to run a CLI —
 * which is both a hurdle and a worse security posture than an authenticated
 * call.
 *
 * It is protected by CRON_SECRET, refuses every request when that is unset, and
 * is idempotent: migrations are tracked in a ledger, the menu import matches on
 * stable keys, and tables and the account are created only if absent. Running it
 * twice changes nothing.
 *
 * It never drops anything, never resets availability a waiter has set, and
 * never returns a credential.
 */
const Body = z.object({
  tables: z.array(z.string().min(1).max(20)).max(100).optional(),
  user: z
    .object({
      email: z.string().email().max(255),
      name: z.string().min(1).max(100),
      password: z.string().min(8).max(200),
    })
    .optional(),
  baseUrl: z.string().url().optional(),
});

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured means no access, rather than an open door.
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Not authorised' } },
      { status: 401 },
    );
  }

  try {
    const body = Body.parse(await request.json().catch(() => ({})));
    const { db: database, executeMultiple } = await getDatabase();

    // --- schema ----------------------------------------------------------
    const migrations = await runMigrations(database, executeMultiple);

    // --- menu ------------------------------------------------------------
    const dataDir = join(process.cwd(), 'data');
    const food = parseMenuCsv(readFileSync(join(dataDir, 'menu_trilingual_EN_DE_VI.csv'), 'utf8'));
    const drinks = parseDrinksCsv(readFileSync(join(dataDir, 'asiaway_drinks_menu.csv'), 'utf8'));

    for (const a of ALLERGENS) {
      await database
        .insert(allergens)
        .values({ code: a.code, nameEn: a.nameEn, nameDe: a.nameDe, nameVi: a.nameVi })
        .onConflictDoUpdate({
          target: allergens.code,
          set: { nameEn: a.nameEn, nameDe: a.nameDe, nameVi: a.nameVi },
        });
    }

    const categoryIds = new Map<string, string>();
    for (const c of [...food.categories, ...drinks.categories]) {
      const [row] = await database
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

    for (const item of [...food.items, ...drinks.items]) {
      await database
        .insert(menuItems)
        .values({
          categoryId: categoryIds.get(item.categorySlug)!,
          externalKey: item.externalKey,
          dishNumber: item.dishNumber || null,
          volume: item.volume ?? null,
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
            categoryId: categoryIds.get(item.categorySlug)!,
            dishNumber: item.dishNumber || null,
            volume: item.volume ?? null,
            nameEn: item.nameEn,
            nameDe: item.nameDe,
            nameVi: item.nameVi,
            descriptionEn: item.descriptionEn,
            descriptionDe: item.descriptionDe,
            descriptionVi: item.descriptionVi,
            priceCents: item.priceCents,
            allergenCodes: [...item.allergenCodes],
            sortOrder: item.sortOrder,
            isActive: true,
            updatedAt: new Date(),
            // Availability is NOT reset: an import must never quietly put a dish
            // the waiter marked sold out back on sale.
          },
        });
    }

    // --- tables ----------------------------------------------------------
    const createdTables: { tableNumber: string; url: string }[] = [];
    const base = (body.baseUrl ?? new URL(request.url).origin).replace(/\/+$/, '');

    for (const tableNumber of body.tables ?? []) {
      const existing = await database
        .select()
        .from(restaurantTables)
        .where(eq(restaurantTables.tableNumber, tableNumber));

      const token = existing[0]?.qrToken ?? generateQrToken();
      if (!existing[0]) {
        await database.insert(restaurantTables).values({
          tableNumber,
          displayName: `Table ${tableNumber}`,
          qrToken: token,
        });
      }
      createdTables.push({ tableNumber, url: `${base}/t/${token}` });
    }

    // --- first staff account ---------------------------------------------
    let userCreated = false;
    if (body.user) {
      const existing = await database
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${body.user.email.toLowerCase()}`);

      if (!existing[0]) {
        await database.insert(users).values({
          email: body.user.email,
          displayName: body.user.name,
          passwordHash: await hashPassword(body.user.password),
          role: 'WAITER',
        });
        userCreated = true;
      }
    }

    const [counts] = await database
      .select({ n: sql<number>`count(*)::int` })
      .from(menuItems)
      .where(eq(menuItems.isActive, true));

    return NextResponse.json({
      migrations,
      menuItems: counts?.n ?? 0,
      foodItems: food.items.length,
      drinkItems: drinks.items.length,
      tables: createdTables,
      userCreated,
    });
  } catch (error) {
    console.error('[setup] failed', error);
    return NextResponse.json(
      {
        error: {
          code: 'SETUP_FAILED',
          message: error instanceof Error ? error.message : 'Setup failed',
        },
      },
      { status: 500 },
    );
  }
}
