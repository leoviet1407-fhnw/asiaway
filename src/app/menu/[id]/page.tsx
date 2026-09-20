'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCustomer } from '../../../components/customer/CustomerProvider';
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
    fetch(`/api/menu/items/${params.id}?lang=${locale}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('item'))))
      .then(setItem)
      .catch(() => setError(true));

    fetch(`/api/allergens?lang=${locale}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setLegend(data.allergens))
      .catch(() => undefined);
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
    <article className="space-y-4">
      <Link href="/menu" className="inline-flex min-h-tap items-center text-sm text-ink-muted">
        ← {t('common.back')}
      </Link>

      {/* No image element at all when there is no photograph: the spec forbids
          placeholder or misleading imagery. */}
      {item.imagePath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imagePath}
          alt={item.name}
          className="aspect-[4/3] w-full rounded-2xl object-cover"
        />
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

      {relevant.length > 0 && (
        <section className="card p-3">
          <h2 className="h-label">{t('menu.allergens')}</h2>
          <ul className="mt-1.5 space-y-1 text-sm text-ink-muted">
            {relevant.map((entry) => (
              <li key={entry.code}>
                <span className="font-semibold text-ink">{entry.code}</span> — {entry.name}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">{t('menu.allergens.note')}</p>
        </section>
      )}

      {!item.isAvailable ? (
        <p className="rounded-xl bg-danger-50 p-3 text-sm font-medium text-danger-500">
          {t('menu.soldOut')}
        </p>
      ) : (
        <div className="fixed inset-x-0 bottom-16 mx-auto max-w-md space-y-2 bg-surface-sunken/95 px-4 py-3 backdrop-blur">
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
