'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatMoney } from '../../lib/format';

export interface SearchableDish {
  id: string;
  dishNumber: string | null;
  volume: string | null;
  nameEn: string;
  nameDe: string;
  nameVi: string;
  priceCents: number;
  isAvailable: boolean;
  categoryName: string;
}

/**
 * Type-ahead dish picker for taking an order at the table.
 *
 * Two ways in, because waiters use both: type part of a name, or type the dish
 * number straight off the printed menu. A purely numeric query matches numbers
 * only, so "40" finds dish 40 rather than every dish with a 40 in its price.
 *
 * All three languages are searched. A Vietnamese-speaking guest says "phở bò"
 * and the waiter should be able to type that, not translate it first.
 *
 * Fully keyboard driven: arrows move, Enter adds, Escape closes. A waiter with
 * a tablet keyboard should never need to reach for the screen, and the list is
 * announced properly for anyone using assistive technology.
 */
export function DishSearch({
  dishes,
  onPick,
}: {
  dishes: SearchableDish[];
  onPick: (dish: SearchableDish) => void;
}) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];

    // A numeric query is a dish number, not a fragment of a name.
    const numeric = /^[\d.]+$/.test(q);

    const scored = dishes
      .map((dish) => {
        const number = (dish.dishNumber ?? '').toLowerCase();
        if (numeric) {
          if (number === q) return { dish, score: 0 };
          if (number.startsWith(q)) return { dish, score: 1 };
          return null;
        }
        const names = [dish.nameEn, dish.nameDe, dish.nameVi].map((n) => n.toLowerCase());
        if (names.some((n) => n.startsWith(q))) return { dish, score: 0 };
        if (names.some((n) => n.includes(q))) return { dish, score: 1 };
        if (dish.categoryName.toLowerCase().includes(q)) return { dish, score: 2 };
        return null;
      })
      .filter((r): r is { dish: SearchableDish; score: number } => r !== null)
      .sort((a, b) => a.score - b.score || a.dish.nameEn.localeCompare(b.dish.nameEn))
      .slice(0, 8);

    return scored.map((r) => r.dish);
  }, [query, dishes]);

  useEffect(() => setHighlight(0), [query]);

  const pick = (dish: SearchableDish) => {
    onPick(dish);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="mb-1 block h-label">
        Add a dish
      </label>
      <input
        id={`${listId}-input`}
        ref={inputRef}
        className="field text-lg"
        autoComplete="off"
        placeholder="Dish number or name — e.g. 40, or phở"
        value={query}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && results[highlight] ? `${listId}-opt-${results[highlight].id}` : undefined
        }
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (results.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => (h + 1) % results.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => (h - 1 + results.length) % results.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const dish = results[highlight];
            if (dish) pick(dish);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />

      {open && query.trim().length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching dishes"
          className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-xl border
                     border-ink/15 bg-surface shadow-lg"
        >
          {results.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-muted">No dish matches “{query}”.</li>
          )}
          {results.map((dish, index) => (
            <li
              key={dish.id}
              id={`${listId}-opt-${dish.id}`}
              role="option"
              aria-selected={index === highlight}
            >
              <button
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(dish)}
                className={`flex min-h-tap w-full items-center justify-between gap-3 px-4 py-3
                            text-left ${index === highlight ? 'bg-brand-50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {dish.dishNumber && <span className="text-ink-muted">{dish.dishNumber} · </span>}
                    {dish.nameEn}
                    {dish.volume && <span className="text-ink-muted"> · {dish.volume}</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {dish.categoryName}
                    {!dish.isAvailable && ' · marked sold out'}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">{formatMoney(dish.priceCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
