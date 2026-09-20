import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPhotoManifest, photoFor } from '../../src/server/menu/photos';
import { parseMenuCsv } from '../../src/server/menu/import';
import { readFileSync } from 'node:fs';

const manifest = loadPhotoManifest();
const menu = parseMenuCsv(
  readFileSync(resolve(process.cwd(), 'data/menu_trilingual_EN_DE_VI.csv'), 'utf8'),
);

describe('dish photographs', () => {
  it('maps 17 photos, all of which exist on disk', () => {
    const entries = Object.entries(manifest.photos);
    expect(entries).toHaveLength(17);
    for (const [dish, path] of entries) {
      expect(existsSync(resolve(process.cwd(), 'public', path.slice(1))), `${dish}: ${path}`).toBe(
        true,
      );
    }
  });

  it('only references dish numbers that actually exist on the menu', () => {
    const numbers = new Set(menu.items.map((i) => i.dishNumber));
    for (const dish of Object.keys(manifest.photos)) {
      expect(numbers.has(dish), `no dish numbered ${dish}`).toBe(true);
    }
  });

  it('gives the prawn summer roll its photo and the other three none', () => {
    // The n 12 photograph shows prawn rolls. Illustrating the beef, duck or
    // tofu variant with it would be a misleading picture, which is worse than
    // no picture at all.
    expect(photoFor(manifest, '12.2')).toBe('/images/menu/dish-12.2.jpg');
    for (const other of ['12.1', '12.3', '12.4']) {
      expect(photoFor(manifest, other), other).toBeNull();
    }
  });

  it('gives the beef red curry its photo and the other three none', () => {
    expect(photoFor(manifest, '91.3')).toBe('/images/menu/dish-91.3.jpg');
    for (const other of ['91.1', '91.2', '91.4']) {
      expect(photoFor(manifest, other), other).toBeNull();
    }
  });

  it('returns null for a dish with no photograph, rather than a stand-in', () => {
    expect(photoFor(manifest, '10')).toBeNull();
    expect(photoFor(manifest, '40')).toBeNull();
    expect(photoFor(manifest, null)).toBeNull();
    expect(photoFor(manifest, 'nonsense')).toBeNull();
  });

  it('leaves the other 39 food dishes without a photo', () => {
    const withPhoto = menu.items.filter((i) => photoFor(manifest, i.dishNumber));
    expect(withPhoto).toHaveLength(17);
    expect(menu.items.length - withPhoto.length).toBe(39);
  });
});
