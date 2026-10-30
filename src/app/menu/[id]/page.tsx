'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCustomer } from '../../../components/customer/CustomerProvider';
import { DishPhoto } from '../../../components/customer/DishPhoto';
import { formatMoney } from '../../../lib/format';

interface ItemDetail {
  id: string;
  dishNumber: string | null;
  volume: string | null;
  name: string;
  description: string;
  priceCents: number;
  allergenCodes: string[];
  imagePath: string | null;
  isAvailable: boolean;
  categoryName: string;
}

export default function ItemDetailPage() {
  const { t, locale, addToCart } = useCustomer();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [legend, setLegend] = useState<{ code: string; name: string }[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState(false);

  useEffect(() => {
    // The language switches to the guest's saved one just after the page opens;
    // a load started in the old language must not land after the new one.
    let current = true;
    fetch(`/api/menu/items/${params.id}?lang=${locale}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('item'))))
      .then((data) => current && setItem(data))
      .catch(() => current && setError(true));

    fetch(`/api/allergens?lang=${locale}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => current && data && setLegend(data.allergens))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [params.id, locale]);

  if (error) {
    return (
      <div className="space-y-3">
        <p className="card p-4 text-sm">{t('common.error')}</p>
        <Link href="/menu" className="btn-secondary">
          {t('common.back')}
        </Link>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t('common.loading')}</span>
        <div className="card h-40 animate-pulse bg-surface-sunken" />
      </div>
    );
  }

  const relevant = legend.filter((entry) => item.allergenCodes.includes(entry.code));

  return (
    // Extra room at the end for the add bar, which is taller than the cart bar
    // the page frame allows for; without it the allergen note ends up beneath it.
    <article className="space-y-4 pb-20">
      <Link href="/menu" className="inline-flex min-h-tap items-center text-sm text-ink-muted">
        ← {t('common.back')}
      </Link>

      {/* No image element at all when there is no photograph: the spec forbids
          placeholder or misleading imagery. */}
      {item.imagePath && (
        // Edge to edge on a phone: the photograph is the reason to open a dish.
        <div className="-mx-4">
          <DishPhoto
            src={item.imagePath}
            alt={item.name}
            sizes="(max-width: 28rem) 100vw, 28rem"
            eager
            className="aspect-square w-full bg-surface-sunken object-cover"
          />
        </div>
      )}

      <header>
        <p className="text-xs uppercase tracking-wide text-ink-muted">{item.categoryName}</p>
        <h1 className="mt-1 text-xl font-semibold">
          {item.dishNumber && <span className="text-ink-muted">{item.dishNumber} · </span>}
          {item.name}
        </h1>
        {item.volume && <p className="mt-1 text-sm text-ink-muted">{item.volume}</p>}
        <p className="mt-2 text-2xl font-semibold">{formatMoney(item.priceCents)}</p>
      </header>

      {item.description && <p className="text-ink-muted">{item.description}</p>}

      {/* An item with no codes must SAY it is undeclared. Rendering nothing
          would read as "contains no allergens", which is a claim the restaurant
          has not made and which a guest could be harmed by trusting. */}
      <section className="card p-3">
        <h2 className="h-label">{t('menu.allergens')}</h2>
        {item.allergenCodes.length === 0 ? (
          <p className="mt-1.5 text-sm text-warn-500">{t('menu.allergens.none')}</p>
        ) : (
          <>
            <ul className="mt-1.5 space-y-1 text-sm text-ink-muted">
              {relevant.map((entry) => (
                <li key={entry.code}>
                  <span className="font-semibold text-ink">{entry.code}</span> — {entry.name}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-muted">{t('menu.allergens.note')}</p>
          </>
        )}
      </section>

      {!item.isAvailable ? (
        <p className="rounded-xl bg-danger-50 p-3 text-sm font-medium text-danger-500">
          {t('menu.soldOut')}
        </p>
      ) : (
        <div className="fixed inset-x-0 bottom-[var(--guest-nav)] z-20 mx-auto max-w-md space-y-2 bg-surface-sunken/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              aria-label="−"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="btn-secondary min-w-tap px-4 text-xl"
            >
              −
            </button>
            <span className="min-w-12 text-center text-lg font-semibold" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              aria-label="+"
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              className="btn-secondary min-w-tap px-4 text-xl"
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => {
              addToCart(
                {
                  menuItemId: item.id,
                  name: item.name,
                  dishNumber: item.dishNumber,
                  unitPriceCents: item.priceCents,
                },
                quantity,
              );
              router.push('/menu');
            }}
          >
            {t('item.add')} · {formatMoney(item.priceCents * quantity)}
          </button>
        </div>
      )}
    </article>
  );
}
