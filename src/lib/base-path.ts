/**
 * The URL prefix the app is served under, e.g. "/staff/app" when it sits
 * behind asiaway.ch/staff/app/. Empty when it has its own (sub)domain.
 * Set NEXT_PUBLIC_BASE_PATH at BUILD time. next/link and redirect() add it by
 * themselves; plain <a>, <img> and the service worker need withBase().
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
