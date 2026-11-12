'use client';

import { useEffect } from 'react';

/** Registers the service worker that makes the app installable (production only). */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production' && !window.location.search.includes('sw=1')) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
