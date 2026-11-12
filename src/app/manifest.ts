import type { MetadataRoute } from 'next';
import { withBase } from '@/lib/base-path';

/** Generated, so start_url, scope and icons follow NEXT_PUBLIC_BASE_PATH. */
export default function manifest(): MetadataRoute.Manifest {
  const icon = (file: string) => withBase(`/icons/${file}`);
  return {
    name: 'AsiaWay Staff',
    short_name: 'AsiaWay Staff',
    description: 'Bestellungen und Wareneingang für AsiaWay',
    lang: 'de-CH',
    start_url: withBase('/'),
    scope: withBase('/'),
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#09141d',
    theme_color: '#09141d',
    icons: [
      { src: icon('icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: icon('icon-512.png'), sizes: '512x512', type: 'image/png' },
      { src: icon('maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Wareneingang', url: withBase('/wareneingang') },
      { name: 'Neue Bestellung', url: withBase('/bestellungen/neu') },
    ],
  };
}
