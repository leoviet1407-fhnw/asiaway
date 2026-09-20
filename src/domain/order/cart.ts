import { domainError } from '../errors';
import type { Cents } from '../../lib/money';
import type { SnapshotItemInput } from './snapshot';

export const CART_LIMITS = {
  maxLines: 60,
  maxQuantityPerLine: 99,
  maxNoteLength: 500,
} as const;

/** What the browser is allowed to send. Note the absence of any price field. */
export interface CartLineRequest {
  readonly menuItemId: string;
  readonly quantity: number;
}

/** The authoritative menu record, read from the database at submit time. */
export interface MenuItemRecord {
  readonly id: string;
  readonly dishNumber: string | null;
  readonly nameEn: string;
  readonly nameDe: string;
  readonly nameVi: string;
  readonly priceCents: Cents;
  readonly allergenCodes: readonly string[];
  readonly isAvailable: boolean;
  readonly isActive: boolean;
}

export interface ValidatedCart {
  readonly items: readonly SnapshotItemInput[];
  readonly note: string | null;
}

/**
 * Turns a client cart into priced order lines using ONLY server-side data.
 *
 * Any price the client sent is ignored by construction — CartLineRequest has no
 * price field, so a tampered request cannot even express one. Availability is
 * checked here against records the caller read inside the same transaction, so
 * an item that sells out mid-checkout is caught rather than served.
 */
export function validateCart(
  lines: readonly CartLineRequest[],
  menuItems: ReadonlyMap<string, MenuItemRecord>,
  note: string | null | undefined,
): ValidatedCart {
  if (lines.length === 0) {
    throw domainError('EMPTY_CART', 'An order must contain at least one item');
  }
  if (lines.length > CART_LIMITS.maxLines) {
    throw domainError(
      'CART_TOO_LARGE',
      `An order may contain at most ${CART_LIMITS.maxLines} lines`,
      { lineCount: lines.length },
    );
  }

  // Merge duplicate lines for the same dish so that quantity changes stay
  // unambiguous in the revision diff.
  const merged = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw domainError('INVALID_QUANTITY', 'Quantity must be a positive whole number', {
        menuItemId: line.menuItemId,
        quantity: line.quantity,
      });
    }
    merged.set(line.menuItemId, (merged.get(line.menuItemId) ?? 0) + line.quantity);
  }

  for (const [menuItemId, quantity] of merged) {
    if (quantity > CART_LIMITS.maxQuantityPerLine) {
      throw domainError(
        'INVALID_QUANTITY',
        `Quantity may not exceed ${CART_LIMITS.maxQuantityPerLine}`,
        { menuItemId, quantity },
      );
    }
  }

  const unknown: string[] = [];
  const unavailable: { menuItemId: string; nameEn: string }[] = [];
  const items: SnapshotItemInput[] = [];

  for (const [menuItemId, quantity] of merged) {
    const record = menuItems.get(menuItemId);
    if (!record || !record.isActive) {
      unknown.push(menuItemId);
      continue;
    }
    if (!record.isAvailable) {
      unavailable.push({ menuItemId, nameEn: record.nameEn });
      continue;
    }
    items.push({
      menuItemId: record.id,
      dishNumber: record.dishNumber,
      nameEn: record.nameEn,
      nameDe: record.nameDe,
      nameVi: record.nameVi,
      unitPriceCents: record.priceCents, // server price, always
      quantity,
      allergenCodes: record.allergenCodes,
    });
  }

  if (unknown.length > 0) {
    throw domainError('VALIDATION_FAILED', 'Cart references unknown or inactive menu items', {
      menuItemIds: unknown,
    });
  }
  if (unavailable.length > 0) {
    throw domainError('ITEMS_UNAVAILABLE', 'Some items are sold out', { items: unavailable });
  }

  return { items, note: cleanNote(note) };
}

const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g');

/** Strips control characters and enforces the length cap. */
export function cleanNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const stripped = note.replace(CONTROL_CHARS, '').trim();
  if (stripped.length === 0) return null;
  if (stripped.length > CART_LIMITS.maxNoteLength) {
    throw domainError(
      'NOTE_TOO_LONG',
      `A special request may be at most ${CART_LIMITS.maxNoteLength} characters`,
      { length: stripped.length },
    );
  }
  return stripped;
}
