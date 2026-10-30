'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCustomer } from '../../components/customer/CustomerProvider';
import { MenuHighlights } from '../../components/customer/MenuHighlights';
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

  // The page opens in the default language and switches to the guest's saved
  // one a moment later, so two loads can be in flight. Only the latest may land:
  // otherwise a German screen could end up listing English dishes.
  const latest = useRef(0);
  const load = useCallback(() => {
    const request = ++latest.current;
    setError(false);
    setCategories(null);
    fetch(`/api/menu?lang=${locale}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('menu'))))
      .then((data) => request === latest.current && setCategories(data.categories))
      .catch(() => request === latest.current && setError(true));
  }, [locale]);

  useEffect(load, [load]);

  // Availability changes while the guest is browsing, so the menu refreshes
  // quietly. The submit call re-checks anyway — this only keeps the screen honest.
  useEffect(() => {
    const id = setInterval(() => {
      const request = ++latest.current;
      fetch(`/api/menu?lang=${locale}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && request === latest.current && setCategories(data.categories))
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(id);
  }, [locale]);

  const shown = (categories ?? []).filter((c) => c.kind === tab);
  const sectionId = (category: Category) => `cat-${category.slug}`;

  // Which category the guest is reading, so the bar can show where they are.
  // A section counts once its top has passed under the header and the bar.
  const [active, setActive] = useState<string | null>(null);
  const chipBar = useRef<HTMLDivElement>(null);
  const shownKey = shown.map((c) => c.slug).join('|');

  useEffect(() => {
    const sections = shownKey
      .split('|')
      .filter(Boolean)
      .map((slug) => document.getElementById(`cat-${slug}`))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const current = sections.find((s) => visible.get(s.id));
        if (current) setActive(current.id);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [shownKey]);

  // Keep the current category's chip in view as the list scrolls past it.
  useEffect(() => {
    const bar = chipBar.current;
    const chip = bar?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!bar || !chip) return;
    const outOfView =
      chip.offsetLeft < bar.scrollLeft ||
      chip.offsetLeft + chip.offsetWidth > bar.scrollLeft + bar.clientWidth;
    if (outOfView) bar.scrollTo({ left: chip.offsetLeft - 16, behavior: 'smooth' });
  }, [active]);

  const jumpTo = (id: string) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  };

  // Photographed dishes, in menu order. Sold-out ones stay in the strip so the
  // menu does not appear to change shape through the evening; the card says so.
  const photographed = (categories ?? [])
    .filter((c) => c.kind === 'FOOD')
    .flatMap((c) => c.items)
    .filter((i) => i.imagePath);

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

      {/* The menu is long — over a hundred dishes in a dozen categories — so a
          bar of categories stays under the header: tap one to jump there, and
          it follows along to show where you are. */}
      {shown.length > 1 && (
        <nav
          aria-label={t('menu.categories')}
          className="sticky top-[var(--guest-header)] z-20 -mx-4 border-b border-ink/10 bg-surface/95 backdrop-blur"
        >
          <div
            ref={chipBar}
            className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {shown.map((category) => {
              const id = sectionId(category);
              const current = active === id;
              return (
                <a
                  key={category.id}
                  href={`#${id}`}
                  data-section={id}
                  aria-current={current ? 'location' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    jumpTo(id);
                  }}
                  className={`flex min-h-tap shrink-0 items-center whitespace-nowrap rounded-xl border px-3 text-sm font-medium ${
                    current
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-ink/15 bg-surface text-ink'
                  }`}
                >
                  {category.name}
                </a>
              );
            })}
          </div>
        </nav>
      )}

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

      {/* Photographed dishes get their own strip. Showing them here rather than
          as a thumbnail per row keeps the list itself clean, since only 17 of
          106 items have a picture. */}
      {tab === 'FOOD' && (
        <MenuHighlights
          items={photographed}
          t={t}
          onAdd={(item) =>
            addToCart({
              menuItemId: item.id,
              name: item.name,
              dishNumber: item.dishNumber,
              unitPriceCents: item.priceCents,
            })
          }
        />
      )}

      {shown.map((category) => (
        <section
          key={category.id}
          id={sectionId(category)}
          // Lands just below the header and the category bar, not under them.
          className="scroll-mt-[calc(var(--guest-header)+4.5rem)] space-y-2"
        >
          <h2 className="h-label pt-2">{category.name}</h2>
          {/* One card per category with thin rules between dishes: the same
              information in far less height than a card for every dish. */}
          <ul className="card divide-y divide-ink/10">
            {category.items.map((item) => (
              <li key={item.id} className="p-3">
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
