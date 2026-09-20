'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useCustomer } from '../../components/customer/CustomerProvider';
import { formatMoney } from '../../lib/format';

interface MenuItem {
  id: string;
  dishNumber: string | null;
  volume: string | null;
  name: string;
  description: string;
  priceCents: number;
  allergenCodes: string[];
  imagePath: string | null;
  isAvailable: boolean;
}

interface Category {
  id: string;
  slug: string;
  kind: 'FOOD' | 'DRINK';
  name: string;
  items: MenuItem[];
}

export default function MenuPage() {
  const { t, locale, addToCart } = useCustomer();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'FOOD' | 'DRINK'>('FOOD');
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    setCategories(null);
    fetch(`/api/menu?lang=${locale}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('menu'))))
      .then((data) => setCategories(data.categories))
      .catch(() => setError(true));
  }, [locale]);

  useEffect(load, [load]);

  // Availability changes while the guest is browsing, so the menu refreshes
  // quietly. The submit call re-checks anyway — this only keeps the screen honest.
  useEffect(() => {
    const id = setInterval(() => {
      fetch(`/api/menu?lang=${locale}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setCategories(data.categories))
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(id);
  }, [locale]);

  const shown = (categories ?? []).filter((c) => c.kind === tab);

  return (
    <div className="space-y-5">
      <h1 className="h-section">{t('menu.title')}</h1>

      <div className="flex gap-2" role="tablist">
        {(['FOOD', 'DRINK'] as const).map((kind) => (
          <button
            key={kind}
            role="tab"
            aria-selected={tab === kind}
            onClick={() => setTab(kind)}
            className={`min-h-tap flex-1 rounded-xl px-4 py-2 text-sm font-semibold ${
              tab === kind ? 'bg-brand-600 text-white' : 'bg-surface text-ink-muted border border-ink/10'
            }`}
          >
            {kind === 'FOOD' ? t('menu.food') : t('menu.drinks')}
          </button>
        ))}
      </div>

      {error && (
        <div className="card p-4">
          <p className="text-sm">{t('common.error')}</p>
          <button className="btn-secondary mt-3" onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      )}

      {!categories && !error && (
        <div className="space-y-3" aria-live="polite" aria-busy="true">
          <span className="sr-only">{t('common.loading')}</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card h-20 animate-pulse bg-surface-sunken" />
          ))}
        </div>
      )}

      {/* Drinks are a real, empty category: the menu says so plainly rather than
          hiding the tab or inventing products. */}
      {categories && shown.length === 0 && (
        <p className="card p-4 text-sm text-ink-muted">
          {tab === 'DRINK' ? t('menu.drinks.empty') : t('menu.empty')}
        </p>
      )}

      {shown.map((category) => (
        <section key={category.id} className="space-y-2">
          <h2 className="h-label pt-2">{category.name}</h2>
          <ul className="space-y-2">
            {category.items.map((item) => (
              <li key={item.id} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/menu/${item.id}`} className="min-w-0 flex-1">
                    <p className="font-medium leading-snug">
                      {item.dishNumber && (
                        <span className="text-ink-muted">{item.dishNumber} · </span>
                      )}
                      {item.name}
                      {/* Drinks are priced by serving size; food has none. */}
                      {item.volume && (
                        <span className="text-ink-muted"> · {item.volume}</span>
                      )}
                    </p>
                    {/* The drinks list carries no descriptions, so skip the line
                        entirely rather than leaving a blank gap. */}
                    {item.description && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">{item.description}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{formatMoney(item.priceCents)}</span>
                      {item.allergenCodes.length > 0 ? (
                        <span className="chip">{item.allergenCodes.join(' ')}</span>
                      ) : (
                        /* Never let "no codes" read as "no allergens". */
                        <span className="chip bg-warn-50 text-warn-500">
                          {t('menu.allergens.none')}
                        </span>
                      )}
                      {!item.isAvailable && (
                        <span className="chip bg-danger-50 text-danger-500">{t('menu.soldOut')}</span>
                      )}
                    </div>
                  </Link>

                  <button
                    type="button"
                    disabled={!item.isAvailable}
                    aria-disabled={!item.isAvailable}
                    aria-label={`${t('item.add')}: ${item.name}`}
                    onClick={() => {
                      addToCart({
                        menuItemId: item.id,
                        name: item.name,
                        dishNumber: item.dishNumber,
                        unitPriceCents: item.priceCents,
                      });
                      setJustAdded(item.id);
                      window.setTimeout(() => setJustAdded(null), 1200);
                    }}
                    className={`min-h-tap min-w-tap shrink-0 rounded-xl px-3 text-lg font-bold ${
                      item.isAvailable
                        ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                        : 'cursor-not-allowed bg-surface-sunken text-ink-muted/50'
                    }`}
                  >
                    {justAdded === item.id ? '✓' : '+'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {categories && (
        <p className="pt-2 text-xs text-ink-muted">{t('menu.vatNote')}</p>
      )}
    </div>
  );
}
