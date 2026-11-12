/**
 * Tagesabschluss (daily closing) rules. All amounts are integer cents.
 *
 * The paper form this replaces:
 *   Cashbestand (Kassa)            counted cash in the till
 *   − Anfangsbestand (Stock)       starting float
 *   = Barumsatz                    cash sales
 *   + EFT, + Mobile Payment
 *   = TOTAL (IST)                  what was actually taken
 *   POS BRUTTO (SOLL)              what the POS says should have been taken
 *   Differenz / Trinkgeld (Tips)   IST − SOLL
 *   POS BRUTTO − EFT (− Mobile)    = BANK EINZAHLEN, the cash to deposit
 *
 * The expected sales figure comes from whatever POS is in use (Hypersoft today),
 * so it is typed in; nothing here depends on a particular POS.
 */

/** Starting float of a till, CHF 300. */
export const DEFAULT_FLOAT_CENTS = 30_000;

/**
 * Stations per location, as on the paper form (Buffet, EG, 1. OG, Glacé). The
 * first one is the default; edit the lists to match the restaurants.
 */
export const STATIONS: Record<string, readonly string[]> = {
  oerlikon: ['Restaurant', 'Bar'],
  'winti-vn': ['1. OG', 'Buffet', 'Glacé'],
  'winti-th': ['EG', 'Buffet', 'Glacé'],
};

export function stationsFor(locationId: string): readonly string[] {
  return STATIONS[locationId] ?? ['Restaurant'];
}

export interface ClosingInput {
  readonly cashCountedCents: number;
  readonly startFloatCents: number;
  readonly eftCents: number;
  readonly mobileCents: number;
  readonly posGrossCents: number;
}

export interface ClosingResult {
  /** Barumsatz: cash in the till minus the starting float. */
  readonly cashSalesCents: number;
  /** TOTAL (IST). */
  readonly totalActualCents: number;
  /** IST − SOLL. Positive: tips (or too much cash); negative: money is missing. */
  readonly differenceCents: number;
  /** The tips part of the difference (never negative). */
  readonly tipsCents: number;
  /** The missing part (never negative). */
  readonly shortfallCents: number;
  /** BANK EINZAHLEN: POS gross − EFT − mobile = the cash sales without the tips. */
  readonly bankDepositCents: number;
}

export function computeClosing(input: ClosingInput): ClosingResult {
  const cashSales = input.cashCountedCents - input.startFloatCents;
  const total = cashSales + input.eftCents + input.mobileCents;
  const difference = total - input.posGrossCents;
  return {
    cashSalesCents: cashSales,
    totalActualCents: total,
    differenceCents: difference,
    tipsCents: Math.max(0, difference),
    shortfallCents: Math.max(0, -difference),
    bankDepositCents: input.posGrossCents - input.eftCents - input.mobileCents,
  };
}

export type DifferenceTone = 'ok' | 'tips' | 'short';

/** Whether the difference is zero, tips (or surplus), or a shortfall to look into. */
export function differenceTone(differenceCents: number): DifferenceTone {
  if (differenceCents === 0) return 'ok';
  return differenceCents > 0 ? 'tips' : 'short';
}

export const DIFFERENCE_LABEL: Record<DifferenceTone, string> = {
  ok: 'Stimmt genau',
  tips: 'Trinkgeld / Überschuss',
  short: 'Fehlbetrag',
};

export type ClosingStatus = 'SUBMITTED' | 'APPROVED';

export const CLOSING_STATUS_LABEL: Record<ClosingStatus, string> = {
  SUBMITTED: 'Abgeschlossen',
  APPROVED: 'Freigegeben',
};

/** Warnings shown while filling in the form, before saving. */
export function closingWarnings(input: ClosingInput): string[] {
  const r = computeClosing(input);
  const warnings: string[] = [];
  if (input.cashCountedCents < input.startFloatCents) warnings.push('Kassenbestand ist kleiner als der Anfangsbestand.');
  if (r.bankDepositCents < 0) warnings.push('Bank einzahlen ist negativ: EFT und Mobile sind höher als der Kassenumsatz.');
  if (r.shortfallCents > 0) warnings.push(`Fehlbetrag von ${(r.shortfallCents / 100).toFixed(2)} CHF – bitte nochmals nachzählen.`);
  return warnings;
}
