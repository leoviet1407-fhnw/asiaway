import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDrinksCsv } from '../../src/server/menu/drinks-import';

const csv = readFileSync(resolve(process.cwd(), 'data/asiaway_drinks_menu.csv'), 'utf8');
const drinks = parseDrinksCsv(csv);

describe('drinks import from the real Asiaway CSV', () => {
  it('reads all 50 rows into 50 drinks', () => {
    expect(drinks.stats.csvRows).toBe(50);
    expect(drinks.stats.itemsProduced).toBe(50);
  });

  it('imports the eight drink categories in printed order', () => {
    expect(drinks.categories.map((c) => c.slug)).toEqual([
      'aperitif',
      'homemade-drinks',
      'exotic-juices',
      'oishi-green-tea',
      'water-and-softdrinks',
      'beer',
      'rice-wine',
      'coffee',
    ]);
    expect(drinks.categories.every((c) => c.kind === 'DRINK')).toBe(true);
  });

  it('sorts drinks after the food, which occupies positions 1-5', () => {
    expect(Math.min(...drinks.categories.map((c) => c.sortOrder))).toBeGreaterThan(5);
  });

  it('parses prices into integer Rappen', () => {
    const byName = new Map(drinks.items.map((i) => [i.nameEn, i]));
    expect(byName.get('Aperol Spritz')!.priceCents).toBe(1200);
    expect(byName.get('Coca Cola')!.priceCents).toBe(530);
    expect(byName.get('Green Tea Original')!.priceCents).toBe(480);
    expect(byName.get('Soju Original (Korea)')!.priceCents).toBe(1700);
    expect(byName.get('Vietnamesischer Eiskaffee')!.priceCents).toBe(680);
  });

  it('keeps the serving volume where the menu states one', () => {
    const byName = new Map(drinks.items.map((i) => [i.nameEn, i]));
    expect(byName.get('Coca Cola')!.volume).toBe('50 cl');
    expect(byName.get('Prosecco')!.volume).toBe('1 dl');
    expect(byName.get('Sake (Japan)')!.volume).toBe('10 cl');
    expect(drinks.stats.withVolume).toBe(27);
  });

  it('leaves volume null where the menu states none', () => {
    const byName = new Map(drinks.items.map((i) => [i.nameEn, i]));
    expect(byName.get('Cappuccino')!.volume).toBeNull();
    expect(byName.get('Aperol Spritz')!.volume).toBeNull();
  });

  it('shows the one printed name in all three languages rather than inventing translations', () => {
    const byName = new Map(drinks.items.map((i) => [i.nameEn, i]));
    const cola = byName.get('Coca Cola')!;
    expect(cola.nameDe).toBe('Coca Cola');
    expect(cola.nameVi).toBe('Coca Cola');

    // German names stay as the restaurant printed them.
    expect(byName.get('Mineralwasser mit Kohlensäure')!.nameVi).toBe(
      'Mineralwasser mit Kohlensäure',
    );
  });

  it('carries NO allergens, because the source supplies none', () => {
    // Allergen data is a legal declaration. The beers almost certainly contain
    // gluten and the coffees milk, but that must come from the restaurant, not
    // be inferred here from a product name.
    expect(drinks.stats.withoutAllergens).toBe(50);
    expect(drinks.items.every((i) => i.allergenCodes.length === 0)).toBe(true);
  });

  it('carries no descriptions, because the source has no description column', () => {
    expect(drinks.items.every((i) => i.descriptionEn === '')).toBe(true);
  });

  it('gives every drink a unique, re-import-stable key', () => {
    const keys = drinks.items.map((i) => i.externalKey);
    expect(new Set(keys).size).toBe(keys.length);
    const byName = new Map(drinks.items.map((i) => [i.nameEn, i]));
    expect(byName.get('Saigon (Vietnam)')!.externalKey).toBe('beer:saigon-vietnam');
  });

  it('cannot collide with a food key, because the category slugs differ', () => {
    const foodSlugs = ['appetizer', 'noodle-soup', 'noodles', 'wok-and-rice', 'fish-and-curry'];
    for (const item of drinks.items) {
      expect(foodSlugs).not.toContain(item.categorySlug);
    }
  });

  it('is deterministic', () => {
    expect(parseDrinksCsv(csv)).toEqual(drinks);
  });

  it('rejects an unknown category rather than inventing one', () => {
    expect(() => parseDrinksCsv(csv.replace('Beer,Saigon', 'Cocktails,Saigon'))).toThrow(
      /unknown category/i,
    );
  });

  it('rejects a missing price or name instead of importing a broken item', () => {
    expect(() => parseDrinksCsv(csv.replace('Aperitif,Aperol Spritz,,12.0', 'Aperitif,,,12.0'))).toThrow(
      /"Name" is empty/,
    );
    expect(() =>
      parseDrinksCsv(csv.replace('Aperitif,Aperol Spritz,,12.0', 'Aperitif,Aperol Spritz,,')),
    ).toThrow(/"Price CHF" is empty/);
  });

  it('rejects a duplicate drink within a category', () => {
    const doubled = csv.replace(
      'Aperitif,Hugo,,12.0',
      'Aperitif,Hugo,,12.0\nAperitif,Hugo,,12.0',
    );
    expect(() => parseDrinksCsv(doubled)).toThrow(/duplicate item/i);
  });
});
