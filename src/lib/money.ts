/**
 * Money is ALWAYS integer minor units (Rappen). Never a float, never a string,
 * never a Number with decimals. CHF only in Phase 1; the currency code travels
 * with the value so Phase 2 can add another without touching call sites.
 */
export const CURRENCY = 'CHF' as const;
export type Currency = typeof CURRENCY;

/** Rappen. 1250 === CHF 12.50 */
export type Cents = number;

export class MoneyError extends Error {}

const DECIMAL_PRICE = /^\d{1,6}(?:\.\d{1,2})?$/;

/**
 * Parses a menu-sheet price ("12.5", "8.50", "24") into Rappen.
 * Rejects anything ambiguous rather than rounding silently — a wrong price is
 * a wrong bill.
 */
export function parsePriceToCents(raw: string): Cents {
  const trimmed = String(raw).trim();
  if (!DECIMAL_PRICE.test(trimmed)) {
    throw new MoneyError(`Unparseable price: ${JSON.stringify(raw)}`);
  }
  const [whole, frac = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new MoneyError(`Price out of range: ${raw}`);
  }
  return cents;
}

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`${label} must be a non-negative integer of minor units, got ${value}`);
  }
  return value;
}

export function lineTotal(unitPriceCents: Cents, quantity: number): Cents {
  assertCents(unitPriceCents, 'unitPriceCents');
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new MoneyError(`quantity must be a positive integer, got ${quantity}`);
  }
  return unitPriceCents * quantity;
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce<Cents>((acc, v) => acc + assertCents(v), 0);
}

/** Display only. Never feed a formatted string back into arithmetic. */
export function formatCents(cents: Cents, locale = 'de-CH'): string {
  assertCents(cents);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
