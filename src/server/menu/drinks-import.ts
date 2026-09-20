import { parse } from 'csv-parse/sync';
import { parsePriceToCents } from '../../lib/money';
import { slugify, type CategoryMeta, type ImportedMenuItem } from './import';

/**
 * Drinks import.
 *
 * The drinks list arrives in a different, thinner shape than the food menu:
 *
 *     Category, Name, Volume, Price CHF
 *
 * It has no per-language names, no descriptions, no allergen codes and no dish
 * numbers, and it adds a serving volume that food does not have. Rather than
 * bend it into the food importer and quietly fabricate the missing columns,
 * this maps what is actually there and leaves the rest genuinely empty:
 *
 *  - One name, shown in all three languages. Most drink names are proper nouns
 *    ("Coca Cola", "Sake", "Tsingtao") and the rest are German as printed. An
 *    invented translation would be worse than an untranslated one.
 *  - No descriptions. The UI omits the line rather than showing a blank.
 *  - NO ALLERGENS. Several drinks certainly carry them — milk in the coffees,
 *    gluten in the beers, sulfites in the wines — but the source supplies none,
 *    and allergen data is a legal declaration, not something to infer from a
 *    product name. See MISSING_ALLERGEN_WARNING.
 */
export const DRINKS_CSV_COLUMNS = {
  category: 'Category',
  name: 'Name',
  volume: 'Volume',
  price: 'Price CHF',
} as const;

/**
 * Categories in printed order, numbered after the food (which occupies 1–5).
 *
 * The German and Vietnamese category names are translations of the English
 * headings, exactly as for the food menu, and are flagged for restaurant review.
 * They are wording, not business data.
 */
export const DRINK_CATEGORY_META: Readonly<Record<string, CategoryMeta>> = {
  Aperitif: {
    slug: 'aperitif',
    kind: 'DRINK',
    nameEn: 'Aperitif',
    nameDe: 'Aperitif',
    nameVi: 'Khai vị (đồ uống)',
    sortOrder: 10,
  },
  'Homemade Drinks': {
    slug: 'homemade-drinks',
    kind: 'DRINK',
    nameEn: 'Homemade Drinks',
    nameDe: 'Hausgemachte Getränke',
    nameVi: 'Đồ uống nhà làm',
    sortOrder: 11,
  },
  'Exotic Juices': {
    slug: 'exotic-juices',
    kind: 'DRINK',
    nameEn: 'Exotic Juices',
    nameDe: 'Exotische Säfte',
    nameVi: 'Nước ép nhiệt đới',
    sortOrder: 12,
  },
  'Oishi Green Tea': {
    slug: 'oishi-green-tea',
    kind: 'DRINK',
    nameEn: 'Oishi Green Tea',
    nameDe: 'Oishi Grüntee',
    nameVi: 'Trà xanh Oishi',
    sortOrder: 13,
  },
  'Water & Softdrinks': {
    slug: 'water-and-softdrinks',
    kind: 'DRINK',
    nameEn: 'Water & Soft Drinks',
    nameDe: 'Wasser & Softdrinks',
    nameVi: 'Nước suối & nước ngọt',
    sortOrder: 14,
  },
  Beer: {
    slug: 'beer',
    kind: 'DRINK',
    nameEn: 'Beer',
    nameDe: 'Bier',
    nameVi: 'Bia',
    sortOrder: 15,
  },
  'Rice Wine': {
    slug: 'rice-wine',
    kind: 'DRINK',
    nameEn: 'Rice Wine',
    nameDe: 'Reiswein',
    nameVi: 'Rượu',
    sortOrder: 16,
  },
  Coffee: {
    slug: 'coffee',
    kind: 'DRINK',
    nameEn: 'Coffee',
    nameDe: 'Kaffee',
    nameVi: 'Cà phê',
    sortOrder: 17,
  },
};

export const MISSING_ALLERGEN_WARNING =
  'The drinks CSV has no allergen column, so every drink is imported with none. ' +
  'Milk in the coffees and Thai Red Milk Tea, gluten in the beers and sulfites ' +
  'in the wines are all likely declarable. Allergen data is a legal declaration ' +
  'and has deliberately NOT been guessed — add an Allergens column and re-import.';

export interface ImportedDrinks {
  readonly categories: readonly CategoryMeta[];
  readonly items: readonly ImportedMenuItem[];
  readonly stats: {
    readonly csvRows: number;
    readonly itemsProduced: number;
    readonly withVolume: number;
    readonly withoutAllergens: number;
  };
}

function required(row: Record<string, string>, column: string, lineNo: number): string {
  const value = (row[column] ?? '').trim();
  if (value.length === 0) throw new Error(`Drinks CSV line ${lineNo}: "${column}" is empty`);
  return value;
}

export function parseDrinksCsv(csvText: string): ImportedDrinks {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  }) as Record<string, string>[];

  if (rows.length === 0) throw new Error('Drinks CSV contains no data rows');

  const seenKeys = new Set<string>();
  const items: ImportedMenuItem[] = rows.map((row, index) => {
    const lineNo = index + 2;
    const category = required(row, DRINKS_CSV_COLUMNS.category, lineNo);
    const meta = DRINK_CATEGORY_META[category];
    if (!meta) {
      throw new Error(
        `Drinks CSV line ${lineNo}: unknown category "${category}". ` +
          `Known: ${Object.keys(DRINK_CATEGORY_META).join(', ')}`,
      );
    }

    const name = required(row, DRINKS_CSV_COLUMNS.name, lineNo);
    const volume = (row[DRINKS_CSV_COLUMNS.volume] ?? '').trim() || null;
    const externalKey = `${meta.slug}:${slugify(name)}`;

    if (seenKeys.has(externalKey)) {
      throw new Error(`Drinks CSV line ${lineNo}: duplicate item "${name}" in ${category}`);
    }
    seenKeys.add(externalKey);

    return {
      externalKey,
      categorySlug: meta.slug,
      // Drinks are not numbered on the printed menu.
      dishNumber: '',
      baseDishNumber: '',
      // One name in all three languages: see the note at the top of this file.
      nameEn: name,
      nameDe: name,
      nameVi: name,
      descriptionEn: '',
      descriptionDe: '',
      descriptionVi: '',
      priceCents: parsePriceToCents(required(row, DRINKS_CSV_COLUMNS.price, lineNo)),
      allergenCodes: [],
      sortOrder: 100 + index,
      volume,
    } satisfies ImportedMenuItem;
  });

  const usedCategories = new Set(items.map((i) => i.categorySlug));
  const categories = Object.values(DRINK_CATEGORY_META)
    .filter((c) => usedCategories.has(c.slug))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    categories,
    items,
    stats: {
      csvRows: rows.length,
      itemsProduced: items.length,
      withVolume: items.filter((i) => i.volume).length,
      withoutAllergens: items.filter((i) => i.allergenCodes.length === 0).length,
    },
  };
}
