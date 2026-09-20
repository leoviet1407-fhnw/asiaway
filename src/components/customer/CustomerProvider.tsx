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

/**
 * An order the guest has sent but is still allowed to change. Held here rather
 * than in the cart page so that walking back to the menu to add a dish does not
 * lose track of which order is being changed.
 */
export interface EditingOrder {
  readonly orderId: string;
  readonly orderNumber: number;
  readonly expiresAt: string;
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
  editingOrder: EditingOrder | null;
  startEditingOrder: (order: EditingOrder, lines: CartLine[]) => void;
  stopEditingOrder: () => void;
}

const Context = createContext<CustomerState | null>(null);

const LOCALE_KEY = 'aw.locale';
const CART_KEY = 'aw.cart';
const EDITING_KEY = 'aw.editingOrder';
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
  const [editingOrder, setEditingOrder] = useState<EditingOrder | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('pending');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedLocale = read<string>(LOCALE_KEY, DEFAULT_LOCALE);
    if (isLocale(storedLocale)) setLocaleState(storedLocale);
    setCart(read<CartLine[]>(CART_KEY, []));

    // Each route mounts its own provider, so this state only survives a
    // navigation by being written down. A window that has since run out is
    // dropped rather than restored: the order is with the kitchen by then.
    const storedEditing = read<EditingOrder | null>(EDITING_KEY, null);
    if (storedEditing && new Date(storedEditing.expiresAt).getTime() > Date.now()) {
      setEditingOrder(storedEditing);
    } else if (storedEditing) {
      write(EDITING_KEY, null);
    }

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

  useEffect(() => {
    if (hydrated) write(EDITING_KEY, editingOrder);
  }, [editingOrder, hydrated]);

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

  /** Loads a sent order back into the cart so the guest can change it. */
  const startEditingOrder = useCallback((order: EditingOrder, lines: CartLine[]) => {
    setEditingOrder(order);
    setCart(lines);
  }, []);

  /** Leaves the order as it stands and empties the working cart. */
  const stopEditingOrder = useCallback(() => {
    setEditingOrder(null);
    setCart([]);
  }, []);

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
      editingOrder,
      startEditingOrder,
      stopEditingOrder,
    }),
    [
      locale,
      setLocale,
      cart,
      addToCart,
      setQuantity,
      removeFromCart,
      clearCart,
      idempotencyKey,
      rotateIdempotencyKey,
      editingOrder,
      startEditingOrder,
      stopEditingOrder,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCustomer(): CustomerState {
  const context = useContext(Context);
  if (!context) throw new Error('useCustomer must be used inside CustomerProvider');
  return context;
}
