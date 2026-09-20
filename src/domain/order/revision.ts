import type { OrderSnapshot, SnapshotItem } from './snapshot';

/**
 * Revision types (master spec §5.4).
 *
 *   ORIGINAL_SUBMISSION  revision 0, written inside the submit transaction,
 *                        before any waiter can reach the order. Immutable.
 *   WAITER_EDIT          one per material change.
 *   FINAL_CONFIRMED      what was actually agreed at the table and keyed into
 *                        the POS — distinct from the working head.
 *   CANCELLATION         a cancellation is a new revision, never an edit.
 */
export const REVISION_TYPES = [
  'ORIGINAL_SUBMISSION',
  'WAITER_EDIT',
  'FINAL_CONFIRMED',
  'CANCELLATION',
] as const;
export type RevisionType = (typeof REVISION_TYPES)[number];

export type ChangeKind =
  | 'ITEM_ADDED'
  | 'ITEM_REMOVED'
  | 'ITEM_QUANTITY_CHANGED'
  | 'CUSTOMER_NOTE_CHANGED'
  | 'WAITER_NOTE_CHANGED'
  | 'STATUS_CHANGED';

export interface OrderChange {
  readonly kind: ChangeKind;
  /** Stable identity of the affected line, where the change is line-scoped. */
  readonly itemKey?: string;
  readonly label?: string;
  readonly before: unknown;
  readonly after: unknown;
}

/**
 * Lines are identified by menu item id where present, falling back to the
 * English name for lines whose menu item was later deactivated. Two lines of
 * the same dish in one order are merged by the cart rules before they ever
 * reach here.
 */
export function itemKey(item: SnapshotItem): string {
  return item.menuItemId ?? `name:${item.nameEn}`;
}

/**
 * Computes the difference between two snapshots.
 *
 * This drives BOTH the audit trail (one event per change, with before/after)
 * and the decision of whether a change is material enough to create a revision.
 */
export function diffSnapshots(before: OrderSnapshot, after: OrderSnapshot): OrderChange[] {
  const changes: OrderChange[] = [];

  const beforeItems = new Map(before.items.map((i) => [itemKey(i), i]));
  const afterItems = new Map(after.items.map((i) => [itemKey(i), i]));

  for (const [key, afterItem] of afterItems) {
    const beforeItem = beforeItems.get(key);
    if (!beforeItem) {
      changes.push({
        kind: 'ITEM_ADDED',
        itemKey: key,
        label: afterItem.nameEn,
        before: null,
        after: { quantity: afterItem.quantity, unitPriceCents: afterItem.unitPriceCents },
      });
    } else if (beforeItem.quantity !== afterItem.quantity) {
      changes.push({
        kind: 'ITEM_QUANTITY_CHANGED',
        itemKey: key,
        label: afterItem.nameEn,
        before: beforeItem.quantity,
        after: afterItem.quantity,
      });
    }
  }

  for (const [key, beforeItem] of beforeItems) {
    if (!afterItems.has(key)) {
      changes.push({
        kind: 'ITEM_REMOVED',
        itemKey: key,
        label: beforeItem.nameEn,
        before: { quantity: beforeItem.quantity, unitPriceCents: beforeItem.unitPriceCents },
        after: null,
      });
    }
  }

  if (before.customerNote !== after.customerNote) {
    changes.push({
      kind: 'CUSTOMER_NOTE_CHANGED',
      before: before.customerNote,
      after: after.customerNote,
    });
  }

  if (before.waiterNote !== after.waiterNote) {
    changes.push({
      kind: 'WAITER_NOTE_CHANGED',
      before: before.waiterNote,
      after: after.waiterNote,
    });
  }

  if (before.status !== after.status) {
    changes.push({ kind: 'STATUS_CHANGED', before: before.status, after: after.status });
  }

  return changes;
}

/**
 * Material = changes what the guest gets or pays, so it must create a revision.
 * A pure status change (opening an order for review) is audited but does not
 * create a revision, otherwise the revision chain fills with noise and stops
 * being a usable record of what was ordered.
 */
export function isMaterialChange(change: OrderChange): boolean {
  return change.kind !== 'STATUS_CHANGED';
}

export function hasMaterialChanges(changes: readonly OrderChange[]): boolean {
  return changes.some(isMaterialChange);
}

export interface RevisionPlan {
  readonly shouldCreateRevision: boolean;
  readonly revisionType: RevisionType;
  readonly changes: readonly OrderChange[];
  readonly materialChanges: readonly OrderChange[];
  readonly totalCentsBefore: number;
  readonly totalCentsAfter: number;
}

/**
 * Decides what a proposed edit means for the history chain. Returns a plan the
 * persistence layer executes inside one transaction, so a revision, its audit
 * events and the state change can never exist without each other.
 */
export function planRevision(
  before: OrderSnapshot,
  after: OrderSnapshot,
  revisionType: RevisionType,
): RevisionPlan {
  const changes = diffSnapshots(before, after);
  const materialChanges = changes.filter(isMaterialChange);
  const alwaysRecorded = revisionType === 'FINAL_CONFIRMED' || revisionType === 'CANCELLATION';

  return {
    shouldCreateRevision: alwaysRecorded || materialChanges.length > 0,
    revisionType,
    changes,
    materialChanges,
    totalCentsBefore: before.totalCents,
    totalCentsAfter: after.totalCents,
  };
}
