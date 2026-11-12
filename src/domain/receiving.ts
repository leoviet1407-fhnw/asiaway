import { isAcceptableScan, normalizeCode } from './ean';
import { roundQty } from './qty';
import type { OrderStatus } from './order';

/**
 * Goods-in rules: how scans count, and how a delivery compares to the order.
 * Pure functions, shared by the scanning screen (client) and the server.
 */

export type LineStatus = 'OK' | 'MISSING' | 'SHORT' | 'EXTRA' | 'WRONG';

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  OK: 'OK',
  MISSING: 'Fehlt',
  SHORT: 'Zu wenig',
  EXTRA: 'Zu viel',
  WRONG: 'Falsch',
};

/** Fresh goods are weighed: a delivery within ±5 % of the order counts as complete. */
export const FRESH_TOLERANCE = 0.05;
const EPSILON = 0.0005;

export interface OrderedLine {
  readonly itemId: string;
  readonly qty: number;
  readonly isFresh: boolean;
}

export interface ReceivedLine {
  readonly itemId: string | null;
  readonly scannedCode: string | null;
  readonly qty: number;
  readonly damaged?: boolean;
}

export interface DiscrepancyRow {
  readonly key: string;
  readonly itemId: string | null;
  readonly scannedCode: string | null;
  readonly onOrder: boolean;
  readonly ordered: number;
  /** Received in earlier deliveries of this order. */
  readonly before: number;
  /** Received in this delivery. */
  readonly now: number;
  readonly total: number;
  /** Still to come after this delivery. */
  readonly open: number;
  readonly status: LineStatus;
  readonly damaged: boolean;
}

export function classifyLine(ordered: number, total: number, isFresh: boolean): LineStatus {
  if (ordered <= 0) return total > EPSILON ? 'WRONG' : 'OK';
  if (total <= EPSILON) return 'MISSING';
  const tolerance = isFresh ? ordered * FRESH_TOLERANCE : 0;
  if (Math.abs(total - ordered) <= tolerance + EPSILON) return 'OK';
  return total < ordered ? 'SHORT' : 'EXTRA';
}

/**
 * Compares the order with everything received so far, including this delivery.
 * Rows come in order: order lines first (in order-line order), then anything
 * received that was not ordered.
 */
export function computeDiscrepancies(
  ordered: readonly OrderedLine[],
  receivedBefore: ReadonlyMap<string, number>,
  current: readonly ReceivedLine[],
): DiscrepancyRow[] {
  const nowByItem = new Map<string, { qty: number; damaged: boolean }>();
  const unknown: ReceivedLine[] = [];
  for (const line of current) {
    if (line.itemId === null) {
      if (line.qty > EPSILON) unknown.push(line);
      continue;
    }
    const prev = nowByItem.get(line.itemId) ?? { qty: 0, damaged: false };
    nowByItem.set(line.itemId, { qty: prev.qty + line.qty, damaged: prev.damaged || Boolean(line.damaged) });
  }

  const rows: DiscrepancyRow[] = [];
  const orderedIds = new Set<string>();
  for (const line of ordered) {
    orderedIds.add(line.itemId);
    const before = roundQty(receivedBefore.get(line.itemId) ?? 0);
    const cur = nowByItem.get(line.itemId);
    const now = roundQty(cur?.qty ?? 0);
    const total = roundQty(before + now);
    rows.push({
      key: line.itemId,
      itemId: line.itemId,
      scannedCode: null,
      onOrder: true,
      ordered: line.qty,
      before,
      now,
      total,
      open: roundQty(Math.max(0, line.qty - total)),
      status: classifyLine(line.qty, total, line.isFresh),
      damaged: cur?.damaged ?? false,
    });
  }

  for (const [itemId, cur] of nowByItem) {
    if (orderedIds.has(itemId) || cur.qty <= EPSILON) continue;
    const now = roundQty(cur.qty);
    rows.push({
      key: itemId,
      itemId,
      scannedCode: null,
      onOrder: false,
      ordered: 0,
      before: 0,
      now,
      total: now,
      open: 0,
      status: 'WRONG',
      damaged: cur.damaged,
    });
  }

  for (const line of unknown) {
    const now = roundQty(line.qty);
    rows.push({
      key: `code:${line.scannedCode}`,
      itemId: null,
      scannedCode: line.scannedCode,
      onOrder: false,
      ordered: 0,
      before: 0,
      now,
      total: now,
      open: 0,
      status: 'WRONG',
      damaged: Boolean(line.damaged),
    });
  }
  return rows;
}

export interface DiscrepancySummary {
  readonly counts: Record<LineStatus, number>;
  readonly damaged: number;
  /** Nothing missing, short, extra, wrong or damaged. */
  readonly allOk: boolean;
  /** Every ordered line is complete (OK or more than ordered). */
  readonly complete: boolean;
}

export function summarize(rows: readonly DiscrepancyRow[]): DiscrepancySummary {
  const counts: Record<LineStatus, number> = { OK: 0, MISSING: 0, SHORT: 0, EXTRA: 0, WRONG: 0 };
  let damaged = 0;
  for (const row of rows) {
    counts[row.status] += 1;
    if (row.damaged) damaged += 1;
  }
  const complete = rows.every((r) => !r.onOrder || r.status === 'OK' || r.status === 'EXTRA');
  const allOk = counts.OK === rows.length && damaged === 0;
  return { counts, damaged, allOk, complete };
}

/**
 * The order's status once this delivery is booked. "Rest kommt noch" keeps an
 * incomplete order open; "Abschliessen" (closeOrder) ends it whatever is open.
 */
export function orderStatusAfterReceipt(rows: readonly DiscrepancyRow[], closeOrder: boolean): OrderStatus {
  if (closeOrder) return 'RECEIVED';
  return summarize(rows).complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
}

// --- Scanning ---------------------------------------------------------------

export interface BarcodeInfo {
  readonly itemId: string;
  readonly unitsPerScan: number;
}

export type ScanResult =
  | { readonly kind: 'invalid'; readonly code: string }
  | { readonly kind: 'unknown'; readonly code: string }
  | { readonly kind: 'item'; readonly code: string; readonly itemId: string; readonly add: number; readonly onOrder: boolean };

/** What one scan means for this delivery. */
export function interpretScan(
  raw: string,
  barcodes: ReadonlyMap<string, BarcodeInfo>,
  orderItemIds: ReadonlySet<string>,
): ScanResult {
  const code = normalizeCode(raw);
  if (!isAcceptableScan(code)) return { kind: 'invalid', code };
  const hit = barcodes.get(code) ?? (code.startsWith('0') && code.length === 13 ? barcodes.get(code.slice(1)) : undefined);
  if (!hit) return { kind: 'unknown', code };
  return { kind: 'item', code, itemId: hit.itemId, add: hit.unitsPerScan, onOrder: orderItemIds.has(hit.itemId) };
}

/**
 * A pack held in front of the camera is read many times a second. The same
 * code is accepted again only after `windowMs` without seeing it.
 */
export class ScanDebouncer {
  private readonly lastSeen = new Map<string, number>();
  constructor(private readonly windowMs = 1500) {}

  accept(code: string, now: number): boolean {
    const last = this.lastSeen.get(code);
    this.lastSeen.set(code, now);
    return last === undefined || now - last >= this.windowMs;
  }
}
