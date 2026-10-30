import type { Viewport } from 'next';

export const BASE_VIEWPORT: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#ac2025',
};

/**
 * The guest pages reach the screen edge on iPhones and pad their header and
 * bottom bar by the safe area themselves (see .guest-frame). Staff screens keep
 * the default, so nothing of theirs can end up under a notch or the home bar.
 */
export const GUEST_VIEWPORT: Viewport = { ...BASE_VIEWPORT, viewportFit: 'cover' };
