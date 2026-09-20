/**
 * Splitting bundled menu rows into one item per orderable thing.
 *
 * The source menu prices several dishes as one printed line covering two or
 * four proteins, e.g.
 *
 *     n° 90  Green Curry   Chicken / Tofu  25.50   (A D / A D F)
 *                          Beef / Prawn    27.50   (A D / A B D)
 *
 * Phase 1 has no structured modifiers, so a guest ordering "Chicken / Tofu"
 * would not have told the kitchen anything, and no single honest allergen set
 * could be displayed — which matters legally. The restaurant's decision (E1) is
 * to publish each protein as its own numbered item: 90.1, 90.2, 90.3, 90.4.
 *
 * This module is pure so the transformation is fully unit-testable without a
 * database, and it fails loudly rather than guessing.
 */

/** " - " in the English rows, " – " (en dash) in the German and Vietnamese rows. */
const VARIANT_SEPARATOR = /\s[-–]\s/g;
const VARIANT_DELIMITER = /\s*\/\s*/;

export interface BundledRow {
  readonly category: string;
  readonly dishNumber: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly nameVi: string;
  readonly descriptionEn: string;
  readonly descriptionDe: string;
  readonly descriptionVi: string;
  readonly priceRaw: string;
  readonly allergensRaw: string;
}

export interface SplitItem {
  readonly category: string;
  /** Base number as printed, e.g. "90". Sub-numbering happens later. */
  readonly baseDishNumber: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly nameVi: string;
  readonly descriptionEn: string;
  readonly descriptionDe: string;
  readonly descriptionVi: string;
  readonly priceRaw: string;
  readonly allergensRaw: string;
}

function splitName(name: string): { prefix: string; separator: string; variants: string[] } | null {
  const matches = [...name.matchAll(VARIANT_SEPARATOR)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return null;

  const prefix = name.slice(0, last.index);
  const separator = last[0];
  const variantSegment = name.slice(last.index + separator.length);
  const variants = variantSegment.split(VARIANT_DELIMITER).map((v) => v.trim());

  return { prefix, separator, variants };
}

/**
 * Expands one CSV row into one or more orderable items.
 *
 * A row is bundled when its allergen cell contains "/" — that is the only
 * unambiguous signal, because a name may legitimately contain a slash.
 */
export function splitBundledRow(row: BundledRow): SplitItem[] {
  const allergenGroups = row.allergensRaw.split(VARIANT_DELIMITER).map((g) => g.trim());

  if (allergenGroups.length === 1) {
    return [
      {
        category: row.category,
        baseDishNumber: row.dishNumber,
        nameEn: row.nameEn,
        nameDe: row.nameDe,
        nameVi: row.nameVi,
        descriptionEn: row.descriptionEn,
        descriptionDe: row.descriptionDe,
        descriptionVi: row.descriptionVi,
        priceRaw: row.priceRaw,
        allergensRaw: row.allergensRaw,
      },
    ];
  }

  const en = splitName(row.nameEn);
  const de = splitName(row.nameDe);
  const vi = splitName(row.nameVi);

  if (!en || !de || !vi) {
    throw new Error(
      `Row "${row.nameEn}" (n° ${row.dishNumber}) has ${allergenGroups.length} allergen groups ` +
        `but a name without a variant separator; cannot split safely.`,
    );
  }

  const counts = [en.variants.length, de.variants.length, vi.variants.length, allergenGroups.length];
  if (new Set(counts).size !== 1) {
    throw new Error(
      `Row "${row.nameEn}" (n° ${row.dishNumber}) is inconsistent: ` +
        `EN ${en.variants.length}, DE ${de.variants.length}, VI ${vi.variants.length} variants ` +
        `but ${allergenGroups.length} allergen groups.`,
    );
  }

  return en.variants.map((_, index) => ({
    category: row.category,
    baseDishNumber: row.dishNumber,
    nameEn: `${en.prefix}${en.separator}${en.variants[index]}`,
    nameDe: `${de.prefix}${de.separator}${de.variants[index]}`,
    nameVi: `${vi.prefix}${vi.separator}${vi.variants[index]}`,
    descriptionEn: row.descriptionEn,
    descriptionDe: row.descriptionDe,
    descriptionVi: row.descriptionVi,
    priceRaw: row.priceRaw,
    allergensRaw: allergenGroups[index]!,
  }));
}

export interface NumberedItem extends SplitItem {
  /** "10" when the dish has a single variant, "90.1" when it has several. */
  readonly displayDishNumber: string;
}

/**
 * Assigns printed dish numbers. A base number that yields exactly one item keeps
 * its plain number (n° 10); one that yields several gets .1, .2, .3 … in menu
 * order, matching the restaurant's chosen format (E1/E3). This also makes dish
 * numbers unique, which the raw CSV's were not.
 */
export function assignDishNumbers(items: readonly SplitItem[]): NumberedItem[] {
  const countsByBase = new Map<string, number>();
  for (const item of items) {
    const key = `${item.category}::${item.baseDishNumber}`;
    countsByBase.set(key, (countsByBase.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return items.map((item) => {
    const key = `${item.category}::${item.baseDishNumber}`;
    const total = countsByBase.get(key)!;
    if (total === 1) {
      return { ...item, displayDishNumber: item.baseDishNumber };
    }
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    return { ...item, displayDishNumber: `${item.baseDishNumber}.${index}` };
  });
}
