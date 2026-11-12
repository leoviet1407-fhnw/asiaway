/** Quantities are stored with 3 decimals (e.g. 2.5 kg). */
export function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Parses "2,5" or "2.5"; returns null for anything that is not a non-negative number. */
export function parseQty(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return null;
  return roundQty(value);
}

export function formatQty(value: number): string {
  return roundQty(value).toLocaleString('de-CH', { maximumFractionDigits: 3 });
}

export function formatChf(cents: number): string {
  return `CHF ${(cents / 100).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "12.50" / "12,5" → 1250 cents. */
export function parseChfToCents(input: string): number | null {
  const text = input.trim().replace(/^CHF\s*/i, '').replace(',', '.').replace(/['’]/g, '');
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** "6.5 kg" for weights and volumes, "2 × Karton à 12" for packs. */
export function formatAmount(qty: number, orderUnit: string): string {
  return /^(kg|g|l|dl)$/i.test(orderUnit.trim()) ? `${formatQty(qty)} ${orderUnit}` : `${formatQty(qty)} × ${orderUnit}`;
}
