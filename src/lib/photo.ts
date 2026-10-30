/**
 * The restaurant's dish photos ship at the widths a phone asks for: WebP at 480,
 * 800 and 1200 px beside the JPEG whose path the database stores, all taken from
 * the full-resolution originals in the printed menu (public/images/menu).
 *
 * Anything else — the weekly special, served from the database — has no such
 * variants and is shown as it is.
 */
const DISH_PHOTO = /^(\/images\/menu\/dish-[\w.-]+)\.jpg$/;

export const PHOTO_WIDTHS = [480, 800, 1200] as const;

/** The WebP srcset for one of the restaurant's dish photos, or null for any other image. */
export function photoSrcSet(path: string): string | null {
  const match = DISH_PHOTO.exec(path);
  if (!match) return null;
  return PHOTO_WIDTHS.map((width) => `${match[1]}-${width}.webp ${width}w`).join(', ');
}
