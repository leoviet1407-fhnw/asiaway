'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useCustomer } from './CustomerProvider';
import { LOCALE_LABELS, LOCALES, type Locale } from '../../i18n/locales';
import { formatMoney } from '../../lib/format';

/**
 * The guest shell: a compact header with the table and language, and a bottom
 * bar within thumb reach.
 *
 * Designed for one-handed use on a phone — every target is at least 44px, and
 * the cart is reachable from every screen without scrolling.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale, cartCount, cartTotalCents } = useCustomer();
  const pathname = usePathname();
  const [table, setTable] = useState<string | null>(null);
  const [sessionClosed, setSessionClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.active) setTable(data.tableNumber);
        else if (data.reason === 'SESSION_CLOSED') setSessionClosed(true);
      })
      .catch(() => {
        // The header degrades to no table label; the page still works.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (sessionClosed) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">{t('session.closed.title')}</h1>
        <p className="text-ink-muted">{t('session.closed.body')}</p>
      </main>
    );
  }

  const tabs = [
    { href: '/menu', label: t('nav.menu') },
    { href: '/orders', label: t('nav.orders') },
    { href: '/checkout', label: t('nav.bill') },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold leading-tight">{t('app.name')}</p>
            {table && (
              <p className="text-xs text-ink-muted">{t('table.label', { table })}</p>
            )}
          </div>
          <label className="sr-only" htmlFor="lang">
            {t('lang.choose')}
          </label>
          <select
            id="lang"
            className="min-h-tap rounded-xl border border-ink/20 bg-surface px-3 py-2 text-sm"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="flex-1 px-4 pb-40 pt-4">{children}</main>

      {cartCount > 0 && pathname !== '/cart' && (
        <div className="fixed inset-x-0 bottom-16 z-20 mx-auto max-w-md px-4 pb-2">
          <Link
            href="/cart"
            className="btn-primary flex w-full items-center justify-between shadow-lg"
          >
            <span>
              {t('nav.cart')} · {cartCount}
            </span>
            <span>{formatMoney(cartTotalCents)}</span>
          </Link>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md border-t border-ink/10 bg-surface"
        aria-label="Main"
      >
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-tap flex-1 items-center justify-center py-3 text-sm font-medium ${
                active ? 'text-brand-600' : 'text-ink-muted'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
