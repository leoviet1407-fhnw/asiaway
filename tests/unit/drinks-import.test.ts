import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDrinksCsv } from '../../src/server/menu/drinks-import';
import { ALLERGEN_CODES } from '../../src/domain/menu/allergens';

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

  it('reads allergen codes from the CSV where they are declared', () => {
    const byName = new Map(drinks.items.map((i) => [i.nameEn, i]));
    // Gluten: beer is a barley product.
    expect(byName.get('Saigon (Vietnam)')!.allergenCodes).toEqual(['A']);
    expect(byName.get('Feldschlösschen Alkoholfrei')!.allergenCodes).toEqual(['A']);
    // Milk: in the name or the definition of the drink.
    expect(byName.get('Cappuccino')!.allergenCodes).toEqual(['G']);
    expect(byName.get('Schale (mit warmer Milch)')!.allergenCodes).toEqual(['G']);
    expect(byName.get('Thai Red Milk Tea')!.allergenCodes).toEqual(['G']);
    // Sulfites: grape-wine based.
    expect(byName.get('Prosecco')!.allergenCodes).toEqual(['O']);
    expect(byName.get('Aperol Spritz')!.allergenCodes).toEqual(['O']);
  });

  it('leaves genuinely uncertain drinks undeclared rather than guessing', () => {
    const byName = new Map(drinks.items.map((i) => [i.nameEn, i]));
    // Sulfites in sake and soju vary by producer; the house coffee recipe
    // decides whether condensed milk is involved. A wrong declaration is worse
    // than a missing one, so these stay blank until the restaurant confirms.
    for (const name of [
      'Sake (Japan)',
      'Soju Original (Korea)',
      'Café Crème',
      'Vietnamesischer Eiskaffee',
    ]) {
      expect(byName.get(name)!.allergenCodes, name).toEqual([]);
    }
  });

  it('declares allergens on 16 drinks and leaves the rest blank', () => {
    expect(drinks.stats.withAllergens).toBe(16);
    expect(drinks.stats.withAllergens + drinks.stats.withoutAllergens).toBe(50);
  });

  it('only ever uses codes from the printed legend', () => {
    for (const item of drinks.items) {
      for (const code of item.allergenCodes) {
        expect(ALLERGEN_CODES.has(code), `${item.nameEn}: ${code}`).toBe(true);
      }
    }
  });

  it('rejects an allergen code that is not in the legend', () => {
    expect(() => parseDrinksCsv(csv.replace('Beer,Saigon (Vietnam),30 cl,6.0,A', 'Beer,Saigon (Vietnam),30 cl,6.0,Z'))).toThrow(
      /allergen/i,
    );
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
    expect(() =>
      parseDrinksCsv(csv.replace('Aperitif,Aperol Spritz,,12.0,O', 'Aperitif,,,12.0,O')),
    ).toThrow(/"Name" is empty/);
    expect(() =>
      parseDrinksCsv(csv.replace('Aperitif,Aperol Spritz,,12.0,O', 'Aperitif,Aperol Spritz,,,O')),
    ).toThrow(/"Price CHF" is empty/);
  });

  it('rejects a duplicate drink within a category', () => {
    const doubled = csv.replace(
      'Aperitif,Hugo,,12.0,O',
      'Aperitif,Hugo,,12.0,O\nAperitif,Hugo,,12.0,O',
    );
    expect(() => parseDrinksCsv(doubled)).toThrow(/duplicate item/i);
  });
});
