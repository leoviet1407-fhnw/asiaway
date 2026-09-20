import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dish photographs, keyed by printed dish number.
 *
 * The photos come from the restaurant's own menu PDF, mapped by the caption
 * printed beside each one and then checked by eye. The mapping lives in
 * data/menu-photos.json rather than in the menu CSV, because the CSV is the
 * restaurant's file and this mapping is derived — it should be reviewable and
 * correctable on its own.
 *
 * A dish with no entry gets no photograph and the UI renders no image element,
 * rather than a placeholder or a stand-in from another dish.
 */
export interface PhotoManifest {
  readonly photos: Readonly<Record<string, string>>;
}

export function loadPhotoManifest(dataDir = join(process.cwd(), 'data')): PhotoManifest {
  try {
    const raw = readFileSync(join(dataDir, 'menu-photos.json'), 'utf8');
    const parsed = JSON.parse(raw) as { photos?: Record<string, string> };
    return { photos: parsed.photos ?? {} };
  } catch {
    // No manifest is a perfectly valid state: every dish simply has no photo.
    return { photos: {} };
  }
}

export function photoFor(manifest: PhotoManifest, dishNumber: string | null): string | null {
  if (!dishNumber) return null;
  return manifest.photos[dishNumber] ?? null;
}
