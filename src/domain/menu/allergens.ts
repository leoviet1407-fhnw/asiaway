/**
 * Allergen legend transcribed from the printed Asiaway menu PDF, which carries
 * 14 codes. The condensed legend in the written spec omitted G = Milch; the
 * restaurant confirmed the printed legend is authoritative (decision E2).
 *
 * The German labels are the source text. English and Vietnamese are standard
 * EU-allergen terminology, not restaurant-specific content.
 */
export interface AllergenDefinition {
  readonly code: string;
  readonly nameDe: string;
  readonly nameEn: string;
  readonly nameVi: string;
}

export const ALLERGENS: readonly AllergenDefinition[] = [
  { code: 'A', nameDe: 'Gluten', nameEn: 'Gluten', nameVi: 'Gluten' },
  { code: 'B', nameDe: 'Krebstiere', nameEn: 'Crustaceans', nameVi: 'Giáp xác' },
  { code: 'C', nameDe: 'Eier', nameEn: 'Eggs', nameVi: 'Trứng' },
  { code: 'D', nameDe: 'Fisch', nameEn: 'Fish', nameVi: 'Cá' },
  { code: 'E', nameDe: 'Erdnüsse', nameEn: 'Peanuts', nameVi: 'Đậu phộng' },
  { code: 'F', nameDe: 'Sojabohnen', nameEn: 'Soybeans', nameVi: 'Đậu nành' },
  { code: 'G', nameDe: 'Milch', nameEn: 'Milk', nameVi: 'Sữa' },
  { code: 'H', nameDe: 'Schalenfrüchte (Nüsse)', nameEn: 'Tree nuts', nameVi: 'Các loại hạt' },
  { code: 'L', nameDe: 'Sellerie', nameEn: 'Celery', nameVi: 'Cần tây' },
  { code: 'M', nameDe: 'Senf', nameEn: 'Mustard', nameVi: 'Mù tạt' },
  { code: 'N', nameDe: 'Sesamsamen', nameEn: 'Sesame seeds', nameVi: 'Hạt vừng' },
  { code: 'O', nameDe: 'Sulfite', nameEn: 'Sulphites', nameVi: 'Sulfite' },
  { code: 'P', nameDe: 'Lupinen', nameEn: 'Lupin', nameVi: 'Đậu lupin' },
  { code: 'R', nameDe: 'Weichtiere', nameEn: 'Molluscs', nameVi: 'Động vật thân mềm' },
];

export const ALLERGEN_CODES: ReadonlySet<string> = new Set(ALLERGENS.map((a) => a.code));

/**
 * The printed menu marks every allergen line with an asterisk meaning
 * "and products derived from them". Displayed as a footnote by the UI.
 */
export const ALLERGEN_DERIVATIVE_NOTE = {
  de: '* und daraus gewonnene Erzeugnisse',
  en: '* and products derived from them',
  vi: '* và các sản phẩm chế biến từ chúng',
} as const;

export function isKnownAllergenCode(code: string): boolean {
  return ALLERGEN_CODES.has(code);
}

/** Parses "A D F" into ["A","D","F"], rejecting anything not in the legend. */
export function parseAllergenCodes(raw: string): string[] {
  const codes = raw
    .trim()
    .split(/[\s,]+/)
    .filter((c) => c.length > 0);

  const unknown = codes.filter((c) => !isKnownAllergenCode(c));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown allergen code(s) ${unknown.join(', ')} in ${JSON.stringify(raw)}. ` +
        `Known codes: ${[...ALLERGEN_CODES].join(', ')}`,
    );
  }
  return codes;
}
