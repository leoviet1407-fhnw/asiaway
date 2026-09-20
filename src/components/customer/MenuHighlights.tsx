'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../../lib/format';
import type { Translator } from '../../i18n';

export interface HighlightItem {
  id: string;
  dishNumber: string | null;
  name: string;
  priceCents: number;
  imagePath: string | null;
  isAvailable: boolean;
}

/**
 * A swipeable strip of the dishes the restaurant has photographs of.
 *
 * Only 17 of 106 items have a photo, so a thumbnail per row left the list
 * ragged and showed good photography at the size of a postage stamp. Collecting
 * them here gives the photos room, keeps the list itself clean and scannable,
 * and gives a guest something to browse before they know what they want.
 *
 * It is a horizontal list of links, not a carousel with autoplay: nothing moves
 * on its own, scrolling is native, and every card is reachable by keyboard and
 * announced by a screen reader.
 */
export function MenuHighlights({
  items,
  t,
  onAdd,
}: {
  items: HighlightItem[];
  t: Translator;
  onAdd: (item: HighlightItem) => void;
}) {
  const scroller = useRef<HTMLUListElement>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(null), 1200);
    return () => window.clearTimeout(timer);
  }, [added]);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="highlights-heading" className="-mx-4">
      <div className="mb-2 px-4">
        <h2 id="highlights-heading" className="h-label">
          {t('menu.highlights')}
        </h2>
        <p className="mt-0.5 text-xs text-ink-muted">{t('menu.highlights.hint')}</p>
      </div>

      <ul
        ref={scroller}
        // scroll-px-4 matters: without it the snap points ignore the padding,
        // the browser scrolls by exactly that much on load, and the first card
        // ends up flush against the screen edge while everything else is inset.
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scroll-px-4
                   [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <li key={item.id} className="w-48 shrink-0 snap-start">
            <article className="card overflow-hidden">
              <Link href={`/menu/${item.id}`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imagePath!}
                  alt=""
                  loading="lazy"
                  className="h-36 w-full bg-surface-sunken object-cover"
                />
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">
                    {item.dishNumber && (
                      <span className="text-ink-muted">{item.dishNumber} · </span>
                    )}
                    {item.name}
                  </p>
                  <p className="mt-1 font-semibold">{formatMoney(item.priceCents)}</p>
                </div>
              </Link>

              <div className="px-3 pb-3">
                {item.isAvailable ? (
                  <button
                    type="button"
                    aria-label={`${t('item.add')}: ${item.name}`}
                    onClick={() => {
                      onAdd(item);
                      setAdded(item.id);
                    }}
                    className="min-h-tap w-full rounded-xl bg-brand-50 text-sm font-semibold
                               text-brand-700 hover:bg-brand-100"
                  >
                    {added === item.id ? t('item.added') : t('item.add')}
                  </button>
                ) : (
                  <p className="min-h-tap rounded-xl bg-danger-50 py-2 text-center text-sm
                                font-medium text-danger-500">
                    {t('menu.soldOut')}
                  </p>
                )}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
