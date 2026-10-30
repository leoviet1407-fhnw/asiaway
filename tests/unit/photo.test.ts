import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHOTO_WIDTHS, photoSrcSet } from '../../src/lib/photo';

const publicDir = resolve(__dirname, '../../public');
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../data/menu-photos.json'), 'utf8'),
) as { photos: Record<string, string> };

describe('dish photo sizes', () => {
  it('offers the three WebP widths beside a stored dish photo', () => {
    expect(photoSrcSet('/images/menu/dish-43.jpg')).toBe(
      '/images/menu/dish-43-480.webp 480w, /images/menu/dish-43-800.webp 800w, /images/menu/dish-43-1200.webp 1200w',
    );
    // Dotted dish numbers keep their dot.
    expect(photoSrcSet('/images/menu/dish-12.2.jpg')).toContain('/images/menu/dish-12.2-800.webp 800w');
  });

  it('leaves every other image alone, such as the weekly special from the database', () => {
    expect(photoSrcSet('/api/menu/specials/2026-10-24/image?v=abc')).toBeNull();
    expect(photoSrcSet('/images/asiaway-logo.png')).toBeNull();
  });

  it('has every size on disk for every photo in the manifest', () => {
    for (const path of Object.values(manifest.photos)) {
      expect(existsSync(resolve(publicDir, `.${path}`)), path).toBe(true);
      for (const width of PHOTO_WIDTHS) {
        const variant = path.replace(/\.jpg$/, `-${width}.webp`);
        expect(existsSync(resolve(publicDir, `.${variant}`)), variant).toBe(true);
      }
    }
  });
});
