import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import { auditEvents, menuCategories, menuItems, users, weeklySpecials } from '../../src/server/db/schema';
import { provisionSaturdayMenu } from '../../src/server/menu/provision-saturday';
import { BANH_MI_KEY, SATURDAY_SPECIAL_KEY } from '../../src/server/menu/saturday-menu';
import {
  getSpecialForDate,
  getSpecialImage,
  listUpcomingSpecials,
  saveWeeklySpecial,
} from '../../src/server/services/specials-service';
import { getMenu } from '../../src/server/services/menu-service';
import type { Db } from '../../src/server/services/order-service';
import type { AppDatabase } from '../../src/server/db/client';

let ctx: TestContext;
let db: Db;
let waiterId: string;

/** 19:00 Zurich on a Saturday and on the Tuesday after it. */
const SATURDAY = new Date('2026-09-19T17:00:00Z');
const TUESDAY = new Date('2026-09-22T17:00:00Z');
const SATURDAY_DATE = '2026-09-19';

/** A one-pixel PNG — real bytes, so the mime and size checks mean something. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const OTHER_PNG = Buffer.concat([PNG, Buffer.from([0])]);

beforeAll(async () => {
  ctx = await createTestDatabase();
  db = ctx.db as unknown as Db;
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.client.exec(`
    truncate audit_events, order_revisions, order_items, order_notes, notifications,
             idempotency_keys, orders, customer_devices, dining_sessions,
             table_group_members, table_groups, weekly_specials, menu_items,
             menu_categories, restaurant_tables, auth_sessions, login_attempts, users
    restart identity cascade;
  `);

  const [waiter] = await db
    .insert(users)
    .values({ email: 'anna@asiaway.test', passwordHash: 'x', displayName: 'Anna' })
    .returning();
  waiterId = waiter!.id;

  // An everyday dish, so "Saturday only" can be told apart from "hidden".
  const [category] = await db
    .insert(menuCategories)
    .values({
      slug: 'noodle-soup',
      kind: 'FOOD',
      nameEn: 'Noodle Soups',
      nameDe: 'Nudelsuppen',
      nameVi: 'Món nước',
      sortOrder: 5,
    })
    .returning();

  await db.insert(menuItems).values({
    categoryId: category!.id,
    externalKey: 'ns:40:pho',
    dishNumber: '40',
    nameEn: 'Beef Noodle Soup',
    nameDe: 'Rindfleisch-Nudelsuppe',
    nameVi: 'Phở bò',
    descriptionEn: 'd',
    descriptionDe: 'd',
    descriptionVi: 'd',
    priceCents: 2450,
    sortOrder: 1,
  });

  await provisionSaturdayMenu(ctx.db as unknown as AppDatabase);
});

const save = (over: Partial<Parameters<typeof saveWeeklySpecial>[1]> = {}) =>
  saveWeeklySpecial(db, {
    serviceDate: SATURDAY_DATE,
    nameEn: 'Grilled sea bass',
    nameDe: 'Gegrillter Wolfsbarsch',
    nameVi: 'Cá chẽm nướng',
    image: { data: PNG, mime: 'image/png' },
    userId: waiterId,
    ...over,
  });

describe('putting the Saturday dishes on the menu', () => {
  it('adds the special and Bánh Mì at the prices the restaurant gave', async () => {
    const rows = await db.select().from(menuItems);

    const special = rows.find((r) => r.externalKey === SATURDAY_SPECIAL_KEY)!;
    expect(special.priceCents).toBe(3350);
    expect(special.availableWeekdays).toEqual([6]);

    const banhMi = rows.find((r) => r.externalKey === BANH_MI_KEY)!;
    expect(banhMi.priceCents).toBe(1450);
    expect(banhMi.availableWeekdays).toEqual([6]);
  });

  it('leaves their allergens empty rather than guessing', async () => {
    const rows = await db.select().from(menuItems);
    for (const key of [SATURDAY_SPECIAL_KEY, BANH_MI_KEY]) {
      expect(rows.find((r) => r.externalKey === key)!.allergenCodes, key).toEqual([]);
    }
  });

  it('can be run again without duplicating anything', async () => {
    await provisionSaturdayMenu(ctx.db as unknown as AppDatabase);
    await provisionSaturdayMenu(ctx.db as unknown as AppDatabase);

    const rows = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.externalKey, BANH_MI_KEY));
    expect(rows).toHaveLength(1);
  });

  it('does not put a sold-out Saturday dish back on sale', async () => {
    await db
      .update(menuItems)
      .set({ isAvailable: false })
      .where(eq(menuItems.externalKey, BANH_MI_KEY));

    await provisionSaturdayMenu(ctx.db as unknown as AppDatabase);

    const [row] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.externalKey, BANH_MI_KEY));
    expect(row!.isAvailable).toBe(false);
  });
});

describe('what a guest sees', () => {
  it('shows neither Saturday dish on a Tuesday', async () => {
    await save();
    const menu = await getMenu(db, 'en', TUESDAY);

    const names = menu.flatMap((c) => c.items.map((i) => i.name));
    expect(names).toContain('Beef Noodle Soup');
    expect(names).not.toContain('Bánh Mì');
    expect(names).not.toContain('Grilled sea bass');
  });

  it('hides the Saturday heading entirely rather than leaving it empty', async () => {
    await save();
    const menu = await getMenu(db, 'en', TUESDAY);
    expect(menu.map((c) => c.slug)).not.toContain('saturday');
  });

  it('shows both on a Saturday, with that week’s name', async () => {
    await save();
    const menu = await getMenu(db, 'en', SATURDAY);

    const saturday = menu.find((c) => c.slug === 'saturday')!;
    expect(saturday).toBeDefined();

    const names = saturday.items.map((i) => i.name);
    expect(names).toContain('Bánh Mì');
    expect(names).toContain('Grilled sea bass');
    expect(names, 'the placeholder name must not reach a guest').not.toContain('Saturday Special');
  });

  it('gives the week’s name in each language', async () => {
    await save();
    for (const [locale, expected] of [
      ['en', 'Grilled sea bass'],
      ['de', 'Gegrillter Wolfsbarsch'],
      ['vi', 'Cá chẽm nướng'],
    ] as const) {
      const menu = await getMenu(db, locale, SATURDAY);
      const names = menu.flatMap((c) => c.items.map((i) => i.name));
      expect(names, locale).toContain(expected);
    }
  });

  it('charges the price the restaurant set, not one the week can change', async () => {
    await save();
    const menu = await getMenu(db, 'en', SATURDAY);
    const special = menu
      .flatMap((c) => c.items)
      .find((i) => i.name === 'Grilled sea bass')!;
    expect(special.priceCents).toBe(3350);
  });

  it('points the photo at the week’s own image, keyed on its contents', async () => {
    const saved = await save();
    const menu = await getMenu(db, 'en', SATURDAY);
    const special = menu.flatMap((c) => c.items).find((i) => i.name === 'Grilled sea bass')!;

    expect(special.imagePath).toBe(
      `/api/menu/specials/${SATURDAY_DATE}/image?v=${saved.imageEtag}`,
    );
  });

  it('shows Bánh Mì but NOT the special when no dish was set that week', async () => {
    // The kitchen has a special, but nobody told the app. Showing the
    // placeholder name with no photo would be worse than showing nothing.
    const menu = await getMenu(db, 'en', SATURDAY);
    const names = menu.flatMap((c) => c.items.map((i) => i.name));

    expect(names).toContain('Bánh Mì');
    expect(names).not.toContain('Saturday Special');
  });

  it('never shows last week’s dish on this week’s Saturday', async () => {
    await save({ serviceDate: '2026-09-12', nameEn: 'Last week’s dish' });

    const menu = await getMenu(db, 'en', SATURDAY);
    const names = menu.flatMap((c) => c.items.map((i) => i.name));
    expect(names).not.toContain('Last week’s dish');
    expect(names).not.toContain('Saturday Special');
  });
});

describe('setting the dish for a Saturday', () => {
  it('stores the photo and reports its size', async () => {
    const saved = await save();
    expect(saved.imageBytes).toBe(PNG.length);

    const image = await getSpecialImage(db, SATURDAY_DATE);
    expect(image!.mime).toBe('image/png');
    expect(Buffer.compare(image!.data, PNG)).toBe(0);
  });

  it('refuses a day that is not a Saturday', async () => {
    await expect(save({ serviceDate: '2026-09-20' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('refuses a half-translated name', async () => {
    await expect(save({ nameDe: '   ' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a file that is not an image', async () => {
    await expect(
      save({ image: { data: PNG, mime: 'application/pdf' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a photo that is too large for the database', async () => {
    await expect(
      save({ image: { data: Buffer.alloc(3 * 1024 * 1024, 1), mime: 'image/jpeg' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a new Saturday with no photo at all', async () => {
    await expect(save({ image: null })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lets a name be corrected without finding the photo again', async () => {
    const first = await save();
    const fixed = await save({ nameEn: 'Grilled seabass', image: null });

    expect(fixed.nameEn).toBe('Grilled seabass');
    expect(fixed.imageEtag, 'the photo is untouched').toBe(first.imageEtag);

    const image = await getSpecialImage(db, SATURDAY_DATE);
    expect(Buffer.compare(image!.data, PNG)).toBe(0);
  });

  it('replaces the photo, and the URL changes with it', async () => {
    const first = await save();
    const second = await save({ image: { data: OTHER_PNG, mime: 'image/png' } });

    // Otherwise a phone holding last week's picture would keep showing it.
    expect(second.imageEtag).not.toBe(first.imageEtag);
  });

  it('keeps one row per Saturday however often it is corrected', async () => {
    await save();
    await save({ nameEn: 'Second thoughts' });
    await save({ nameEn: 'Third thoughts' });

    const rows = await db
      .select()
      .from(weeklySpecials)
      .where(eq(weeklySpecials.serviceDate, SATURDAY_DATE));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nameEn).toBe('Third thoughts');
  });

  it('records who set it and whether the photo changed', async () => {
    await save();
    await save({ nameEn: 'Corrected', image: null });

    const events = await db.select().from(auditEvents).orderBy(auditEvents.id);
    const set = events.find((e) => e.action === 'SATURDAY_SPECIAL_SET')!;
    const updated = events.find((e) => e.action === 'SATURDAY_SPECIAL_UPDATED')!;

    expect(set.actorUserId).toBe(waiterId);
    expect((set.metadata as any).photoReplaced).toBe(true);
    expect((updated.metadata as any).photoReplaced, 'only the name changed').toBe(false);
    expect((updated.metadata as any).serviceDate).toBe(SATURDAY_DATE);
  });
});

describe('the staff screen’s list', () => {
  it('shows the Saturdays still to come, and not the ones gone by', async () => {
    await save({ serviceDate: '2026-09-12', nameEn: 'Old' });
    await save({ serviceDate: SATURDAY_DATE });
    await save({ serviceDate: '2026-09-26', nameEn: 'Next' });

    const upcoming = await listUpcomingSpecials(db, SATURDAY_DATE);
    expect(upcoming.map((s) => s.serviceDate)).toEqual(['2026-09-26', SATURDAY_DATE]);
  });

  it('reports nothing for a Saturday never set', async () => {
    expect(await getSpecialForDate(db, '2027-01-02')).toBeNull();
  });
});
