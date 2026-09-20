'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_LOCALE, type Locale, isLocale } from '../../i18n/locales';
import { createTranslator, type Translator } from '../../i18n';

/**
 * Guest-side state: chosen language and the cart.
 *
 * Both live in localStorage, so a reload, an accidental tab close or a phone
 * locking itself mid-meal does not lose the order being assembled. Neither is
 * ever trusted by the server: the cart carries item ids and quantities only,
 * and every price is recomputed server-side at submit.
 */
export interface CartLine {
  readonly menuItemId: string;
  readonly name: string;
  readonly dishNumber: string | null;
  readonly unitPriceCents: number;
  readonly quantity: number;
}

interface CustomerState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  cart: CartLine[];
  addToCart: (line: Omit<CartLine, 'quantity'>, quantity?: number) => void;
  setQuantity: (menuItemId: string, quantity: number) => void;
  removeFromCart: (menuItemId: string) => void;
  clearCart: () => void;
  cartCount: number;
  cartTotalCents: number;
  /** Reused across retries so a network hiccup cannot create a second order. */
  idempotencyKey: string;
  rotateIdempotencyKey: () => void;
}

const Context = createContext<CustomerState | null>(null);

const LOCALE_KEY = 'aw.locale';
const CART_KEY = 'aw.cart';
const KEY_KEY = 'aw.idemKey';

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Private mode, blocked storage, or corrupt data: carry on without it.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience here, never a requirement.
  }
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('pending');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedLocale = read<string>(LOCALE_KEY, DEFAULT_LOCALE);
    if (isLocale(storedLocale)) setLocaleState(storedLocale);
    setCart(read<CartLine[]>(CART_KEY, []));
    const storedKey = read<string>(KEY_KEY, '');
    setIdempotencyKey(storedKey || newKey());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) write(CART_KEY, cart);
  }, [cart, hydrated]);

  useEffect(() => {
    if (hydrated) write(KEY_KEY, idempotencyKey);
  }, [idempotencyKey, hydrated]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    write(LOCALE_KEY, next);
    document.documentElement.lang = next;
  }, []);

  const addToCart = useCallback((line: Omit<CartLine, 'quantity'>, quantity = 1) => {
    setCart((current) => {
      const existing = current.find((l) => l.menuItemId === line.menuItemId);
      if (existing) {
        return current.map((l) =>
          l.menuItemId === line.menuItemId
            ? { ...l, quantity: Math.min(99, l.quantity + quantity) }
            : l,
        );
      }
      return [...current, { ...line, quantity: Math.min(99, quantity) }];
    });
  }, []);

  const setQuantity = useCallback((menuItemId: string, quantity: number) => {
    setCart((current) =>
      quantity <= 0
        ? current.filter((l) => l.menuItemId !== menuItemId)
        : current.map((l) =>
            l.menuItemId === menuItemId ? { ...l, quantity: Math.min(99, quantity) } : l,
          ),
    );
  }, []);

  const removeFromCart = useCallback((menuItemId: string) => {
    setCart((current) => current.filter((l) => l.menuItemId !== menuItemId));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);
  const rotateIdempotencyKey = useCallback(() => setIdempotencyKey(newKey()), []);

  const value = useMemo<CustomerState>(
    () => ({
      locale,
      setLocale,
      t: createTranslator(locale),
      cart,
      addToCart,
      setQuantity,
      removeFromCart,
      clearCart,
      cartCount: cart.reduce((n, l) => n + l.quantity, 0),
      cartTotalCents: cart.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0),
      idempotencyKey,
      rotateIdempotencyKey,
    }),
    [locale, setLocale, cart, addToCart, setQuantity, removeFromCart, clearCart, idempotencyKey, rotateIdempotencyKey],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCustomer(): CustomerState {
  const context = useContext(Context);
  if (!context) throw new Error('useCustomer must be used inside CustomerProvider');
  return context;
}
