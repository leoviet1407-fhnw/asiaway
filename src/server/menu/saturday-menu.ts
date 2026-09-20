/**
 * The Saturday menu, as the restaurant gave it on 2026-09-20:
 *
 *   - a special dish at CHF 33.50, which changes every Saturday and carries
 *     that week's photograph and name;
 *   - Bánh Mì at CHF 14.50, on the menu every Saturday.
 *
 * Held in code rather than in a CSV because these two came directly from the
 * restaurant rather than from their printed menu file, and writing invented
 * rows into their own CSV would blur which data is theirs.
 *
 * NOT filled in, deliberately:
 *
 *   - Allergens. Bánh Mì almost certainly contains gluten, and the weekly
 *     special's allergens change with the dish, but guessing an allergen is how
 *     somebody gets hurt. Both are empty until the restaurant says otherwise;
 *     `docs/SATURDAY_MENU_REVIEW.md` is the sign-off sheet.
 *   - Descriptions. The weekly special's description arrives with its photo
 *     each week; Bánh Mì's is the restaurant's to write.
 *   - A dish number. Neither appears on the printed menu, and inventing a
 *     number would collide with the numbering guests read from it.
 */

export const SATURDAY_CATEGORY = {
  slug: 'saturday',
  kind: 'FOOD' as const,
  nameEn: 'Saturday',
  nameDe: 'Samstag',
  nameVi: 'Thứ Bảy',
  // First, because on a Saturday this is the thing worth seeing first — and on
  // every other day the whole category is hidden anyway.
  sortOrder: 0,
};

/** The stable identity of the dish whose name and photo change each week. */
export const SATURDAY_SPECIAL_KEY = 'sat:special';
export const BANH_MI_KEY = 'sat:banh-mi';

export interface SaturdayMenuItem {
  readonly externalKey: string;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly nameVi: string;
  readonly descriptionEn: string;
  readonly descriptionDe: string;
  readonly descriptionVi: string;
  readonly priceCents: number;
  readonly sortOrder: number;
}

export const SATURDAY_ITEMS: readonly SaturdayMenuItem[] = [
  {
    externalKey: SATURDAY_SPECIAL_KEY,
    // A placeholder only. Every week's row in `weekly_specials` supplies the
    // real name, and without such a row the dish is not shown at all.
    nameEn: 'Saturday Special',
    nameDe: 'Samstagsspecial',
    nameVi: 'Món đặc biệt thứ Bảy',
    descriptionEn: '',
    descriptionDe: '',
    descriptionVi: '',
    priceCents: 3350,
    sortOrder: 1,
  },
  {
    externalKey: BANH_MI_KEY,
    nameEn: 'Bánh Mì',
    nameDe: 'Bánh Mì',
    nameVi: 'Bánh mì',
    descriptionEn: '',
    descriptionDe: '',
    descriptionVi: '',
    priceCents: 1450,
    sortOrder: 2,
  },
];

/** ISO-8601 weekday numbers. Both dishes are sold on Saturdays only. */
export const SATURDAY_WEEKDAYS = [6];
