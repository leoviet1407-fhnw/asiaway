import { parse } from 'csv-parse/sync';
import { parseAllergenCodes } from '../../domain/menu/allergens';
import {
  assignDishNumbers,
  splitBundledRow,
  type BundledRow,
  type NumberedItem,
} from '../../domain/menu/variants';
import { parsePriceToCents } from '../../lib/money';

/**
 * Menu import: trilingual CSV -> validated, orderable items.
 *
 * Pure and synchronous so the whole transformation can be tested without a
 * database. It fails loudly on bad data rather than importing something
 * plausible-looking: a wrong price or a wrong allergen set is worse than a
 * failed import.
 */

export const CSV_COLUMNS = {
  category: 'Category',
  dishNumber: 'Dish No.',
  nameEn: 'Name - English',
  nameDe: 'Name - German',
  nameVi: 'Name - Vietnamese',
  descriptionEn: 'Description - English',
  descriptionDe: 'Description - German',
  descriptionVi: 'Description - Vietnamese',
  price: 'Price CHF',
  allergens: 'Allergens',
} as const;

/**
 * Category metadata. The source CSV and PDF label categories in English only,
 * so the German and Vietnamese names here are translations and are marked for
 * restaurant review — they are wording, not business data.
 *
 * `kind` separates food from drinks (Improvement 6). No drink category is
 * seeded: the drinks menu has not been supplied and nothing will be invented.
 */
export interface CategoryMeta {
  readonly slug: string;
  readonly kind: 'FOOD' | 'DRINK';
  readonly nameEn: string;
  readonly nameDe: string;
  readonly nameVi: string;
  readonly sortOrder: number;
}

export const CATEGORY_META: Readonly<Record<string, CategoryMeta>> = {
  Appetizer: {
    slug: 'appetizer',
    kind: 'FOOD',
    nameEn: 'Appetizers',
    nameDe: 'Vorspeisen',
    nameVi: 'Khai vị',
    sortOrder: 1,
  },
  'Noodle Soup': {
    slug: 'noodle-soup',
    kind: 'FOOD',
    nameEn: 'Noodle Soups',
    nameDe: 'Nudelsuppen',
    nameVi: 'Món nước',
    sortOrder: 2,
  },
  Noodles: {
    slug: 'noodles',
    kind: 'FOOD',
    nameEn: 'Noodles',
    nameDe: 'Nudeln',
    nameVi: 'Mì & bún',
    sortOrder: 3,
  },
  'Wok & Rice': {
    slug: 'wok-and-rice',
    kind: 'FOOD',
    nameEn: 'Wok & Rice',
    nameDe: 'Wok & Reis',
    nameVi: 'Món xào & cơm',
    sortOrder: 4,
  },
  'Fish & Curry': {
    slug: 'fish-and-curry',
    kind: 'FOOD',
    nameEn: 'Fish & Curry',
    nameDe: 'Fisch & Curry',
    nameVi: 'Cá & cà ri',
    sortOrder: 5,
  },
};

export interface ImportedMenuItem {
  readonly externalKey: string;
  readonly categorySlug: string;
  readonly dishNumber: string;
  readonly baseDishNumber: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly nameVi: string;
  readonly descriptionEn: string;
  readonly descriptionDe: string;
  readonly descriptionVi: string;
  readonly priceCents: number;
  readonly allergenCodes: readonly string[];
  readonly sortOrder: number;
}

export interface ImportedMenu {
  readonly categories: readonly CategoryMeta[];
  readonly items: readonly ImportedMenuItem[];
  readonly stats: {
    readonly csvRows: number;
    readonly itemsProduced: number;
    readonly rowsSplit: number;
  };
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Stable key for idempotent re-import. Built from the category, the BASE dish
 * number and the English name — never the display number, because sub-numbering
 * shifts if the restaurant reorders the menu, and a shifting key would create
 * duplicates on the next import.
 */
export function buildExternalKey(categorySlug: string, baseDishNumber: string, nameEn: string): string {
  return `${categorySlug}:${baseDishNumber}:${slugify(nameEn)}`;
}

function requireColumn(row: Record<string, string>, column: string, lineNo: number): string {
  const value = row[column];
  if (value === undefined) {
    throw new Error(`CSV line ${lineNo}: missing column "${column}"`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`CSV line ${lineNo}: column "${column}" is empty`);
  }
  return trimmed;
}

export function parseMenuCsv(csvText: string): ImportedMenu {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: false,
  }) as Record<string, string>[];

  if (rows.length === 0) throw new Error('Menu CSV contains no data rows');

  const bundled: BundledRow[] = rows.map((row, index) => {
    const lineNo = index + 2; // header is line 1
    const category = requireColumn(row, CSV_COLUMNS.category, lineNo);
    if (!CATEGORY_META[category]) {
      throw new Error(
        `CSV line ${lineNo}: unknown category "${category}". ` +
          `Known: ${Object.keys(CATEGORY_META).join(', ')}`,
      );
    }
    return {
      category,
      dishNumber: requireColumn(row, CSV_COLUMNS.dishNumber, lineNo),
      nameEn: requireColumn(row, CSV_COLUMNS.nameEn, lineNo),
      nameDe: requireColumn(row, CSV_COLUMNS.nameDe, lineNo),
      nameVi: requireColumn(row, CSV_COLUMNS.nameVi, lineNo),
      descriptionEn: requireColumn(row, CSV_COLUMNS.descriptionEn, lineNo),
      descriptionDe: requireColumn(row, CSV_COLUMNS.descriptionDe, lineNo),
      descriptionVi: requireColumn(row, CSV_COLUMNS.descriptionVi, lineNo),
      priceRaw: requireColumn(row, CSV_COLUMNS.price, lineNo),
      allergensRaw: requireColumn(row, CSV_COLUMNS.allergens, lineNo),
    };
  });

  let rowsSplit = 0;
  const split = bundled.flatMap((row) => {
    const produced = splitBundledRow(row);
    if (produced.length > 1) rowsSplit += 1;
    return produced;
  });

  // Dish numbers are assigned per category, in menu order, so the printed
  // numbering (90.1, 90.2, ...) matches the order the guest reads.
  const numbered: NumberedItem[] = Object.keys(CATEGORY_META).flatMap((category) =>
    assignDishNumbers(split.filter((item) => item.category === category)),
  );

  const seenKeys = new Set<string>();
  const items: ImportedMenuItem[] = numbered.map((item, index) => {
    const meta = CATEGORY_META[item.category]!;
    const externalKey = buildExternalKey(meta.slug, item.baseDishNumber, item.nameEn);
    if (seenKeys.has(externalKey)) {
      throw new Error(`Duplicate external key "${externalKey}" — menu items must be distinguishable`);
    }
    seenKeys.add(externalKey);

    return {
      externalKey,
      categorySlug: meta.slug,
      dishNumber: item.displayDishNumber,
      baseDishNumber: item.baseDishNumber,
      nameEn: item.nameEn,
      nameDe: item.nameDe,
      nameVi: item.nameVi,
      descriptionEn: item.descriptionEn,
      descriptionDe: item.descriptionDe,
      descriptionVi: item.descriptionVi,
      priceCents: parsePriceToCents(item.priceRaw),
      allergenCodes: parseAllergenCodes(item.allergensRaw),
      sortOrder: index + 1,
    };
  });

  const usedCategories = new Set(items.map((i) => i.categorySlug));
  const categories = Object.values(CATEGORY_META)
    .filter((c) => usedCategories.has(c.slug))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    categories,
    items,
    stats: { csvRows: rows.length, itemsProduced: items.length, rowsSplit },
  };
}
