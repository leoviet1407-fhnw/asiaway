import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMenuCsv, buildExternalKey } from '../../src/server/menu/import';
import { ALLERGEN_CODES } from '../../src/domain/menu/allergens';

const csv = readFileSync(resolve(process.cwd(), 'data/menu_trilingual_EN_DE_VI.csv'), 'utf8');
const menu = parseMenuCsv(csv);

describe('menu import from the real Asiaway CSV', () => {
  it('reads all 50 source rows and produces 56 orderable items', () => {
    expect(menu.stats.csvRows).toBe(50);
    expect(menu.stats.itemsProduced).toBe(56);
    expect(menu.stats.rowsSplit).toBe(6); // the six bundled curry rows
  });

  it('imports the five food categories, and no drinks', () => {
    expect(menu.categories.map((c) => c.slug)).toEqual([
      'appetizer',
      'noodle-soup',
      'noodles',
      'wok-and-rice',
      'fish-and-curry',
    ]);
    expect(menu.categories.every((c) => c.kind === 'FOOD')).toBe(true);
  });

  it('splits the curries into four numbered items each, with correct prices', () => {
    const green = menu.items.filter((i) => i.baseDishNumber === '90');
    expect(green.map((i) => [i.dishNumber, i.nameEn, i.priceCents])).toEqual([
      ['90.1', 'Green Curry - Chicken', 2550],
      ['90.2', 'Green Curry - Tofu', 2550],
      ['90.3', 'Green Curry - Beef', 2750],
      ['90.4', 'Green Curry - Prawn', 2750],
    ]);
  });

  it('gives each curry variant its own allergen set', () => {
    const byName = new Map(menu.items.map((i) => [i.nameEn, i]));
    expect(byName.get('Green Curry - Chicken')!.allergenCodes).toEqual(['A', 'D']);
    expect(byName.get('Green Curry - Tofu')!.allergenCodes).toEqual(['A', 'D', 'F']);
    expect(byName.get('Green Curry - Prawn')!.allergenCodes).toEqual(['A', 'B', 'D']);
    expect(byName.get('Massaman Curry - Prawn')!.allergenCodes).toEqual(['A', 'B', 'D', 'H']);
  });

  it('sub-numbers the four summer rolls that shared n 12', () => {
    const rolls = menu.items.filter((i) => i.baseDishNumber === '12');
    expect(rolls.map((i) => i.dishNumber)).toEqual(['12.1', '12.2', '12.3', '12.4']);
    expect(rolls.map((i) => i.priceCents)).toEqual([850, 850, 850, 750]);
  });

  it('leaves single-variant dishes with their plain printed number', () => {
    const kimchi = menu.items.find((i) => i.nameEn === 'Kimchi')!;
    expect(kimchi.dishNumber).toBe('11');
    expect(kimchi.priceCents).toBe(750);
    expect(kimchi.allergenCodes).toEqual(['B', 'D', 'O']);
  });

  it('makes every dish number unique, which the raw CSV was not', () => {
    const numbers = menu.items.map((i) => i.dishNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('gives every item a unique, re-import-stable external key', () => {
    const keys = menu.items.map((i) => i.externalKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(buildExternalKey('fish-and-curry', '90', 'Green Curry - Chicken')).toBe(
      'fish-and-curry:90:green-curry-chicken',
    );
  });

  it('keeps all three languages populated for every item', () => {
    for (const i of menu.items) {
      for (const field of [i.nameEn, i.nameDe, i.nameVi, i.descriptionEn, i.descriptionDe, i.descriptionVi]) {
        expect(field.length, i.nameEn).toBeGreaterThan(0);
      }
    }
  });

  it('only uses allergen codes that exist in the printed legend', () => {
    for (const i of menu.items) {
      for (const code of i.allergenCodes) {
        expect(ALLERGEN_CODES.has(code), `${i.nameEn}: ${code}`).toBe(true);
      }
    }
  });

  it('prices every item above zero and in whole Rappen', () => {
    for (const i of menu.items) {
      expect(Number.isSafeInteger(i.priceCents), i.nameEn).toBe(true);
      expect(i.priceCents, i.nameEn).toBeGreaterThan(0);
    }
  });

  it('is deterministic: importing twice gives an identical result', () => {
    expect(parseMenuCsv(csv)).toEqual(menu);
  });

  it('rejects an unknown category rather than inventing one', () => {
    const bad = csv.replace('Appetizer,10', 'Desserts,10');
    expect(() => parseMenuCsv(bad)).toThrow(/unknown category/i);
  });

  it('rejects an unknown allergen code', () => {
    const bad = csv.replace(',12.5,A\n', ',12.5,Z\n');
    expect(() => parseMenuCsv(bad)).toThrow(/allergen/i);
  });
});
