import { type Cents, assertCents, lineTotal, sumCents } from '../../lib/money';
import type { OrderStatus } from './status';

/**
 * A snapshot is the COMPLETE state of an order at a point in time — not a diff.
 *
 * Full snapshots are deliberate: "show me exactly what the guest originally
 * ordered" must be one row read with no replay logic, because that reconstruction
 * is a hard requirement (master spec §5.4) and replay code is where history
 * quietly rots.
 *
 * Item text and prices are copied in, never referenced by id, so that later menu
 * edits can never rewrite what a guest actually ordered.
 */
export interface SnapshotItem {
  readonly menuItemId: string | null;
  readonly dishNumber: string | null;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly nameVi: string;
  readonly unitPriceCents: Cents;
  readonly quantity: number;
  readonly lineTotalCents: Cents;
  readonly allergenCodes: readonly string[];
}

export interface OrderSnapshot {
  readonly status: OrderStatus;
  readonly items: readonly SnapshotItem[];
  readonly customerNote: string | null;
  readonly waiterNote: string | null;
  readonly totalCents: Cents;
}

export interface SnapshotItemInput {
  menuItemId: string | null;
  dishNumber: string | null;
  nameEn: string;
  nameDe: string;
  nameVi: string;
  unitPriceCents: Cents;
  quantity: number;
  allergenCodes: readonly string[];
}

/**
 * Builds a snapshot, recomputing every line total and the order total from unit
 * price × quantity. Callers cannot inject a total — that is the whole point.
 */
export function buildSnapshot(input: {
  status: OrderStatus;
  items: readonly SnapshotItemInput[];
  customerNote?: string | null;
  waiterNote?: string | null;
}): OrderSnapshot {
  const items: SnapshotItem[] = input.items.map((item) => ({
    menuItemId: item.menuItemId,
    dishNumber: item.dishNumber,
    nameEn: item.nameEn,
    nameDe: item.nameDe,
    nameVi: item.nameVi,
    unitPriceCents: assertCents(item.unitPriceCents, 'unitPriceCents'),
    quantity: item.quantity,
    lineTotalCents: lineTotal(item.unitPriceCents, item.quantity),
    allergenCodes: [...item.allergenCodes],
  }));

  return {
    status: input.status,
    items,
    customerNote: normaliseNote(input.customerNote),
    waiterNote: normaliseNote(input.waiterNote),
    totalCents: sumCents(items.map((i) => i.lineTotalCents)),
  };
}

function normaliseNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function snapshotTotal(snapshot: OrderSnapshot): Cents {
  return snapshot.totalCents;
}
