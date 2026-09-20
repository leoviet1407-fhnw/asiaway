import { describe, expect, it } from 'vitest';
import { cleanNote, validateCart, type MenuItemRecord } from '../../src/domain/order/cart';
import { DomainError } from '../../src/domain/errors';

const item = (over: Partial<MenuItemRecord> = {}): MenuItemRecord => ({
  id: 'item-1',
  dishNumber: '40',
  nameEn: 'Beef Noodle Soup',
  nameDe: 'Rindfleisch-Nudelsuppe',
  nameVi: 'Phở bò',
  priceCents: 2450,
  allergenCodes: ['D', 'F'],
  isAvailable: true,
  isActive: true,
  ...over,
});

const menu = (...items: MenuItemRecord[]) => new Map(items.map((i) => [i.id, i]));

describe('cart validation', () => {
  it('prices every line from the server record', () => {
    const cart = validateCart([{ menuItemId: 'item-1', quantity: 2 }], menu(item()), null);
    expect(cart.items[0]!.unitPriceCents).toBe(2450);
  });

  it('cannot be influenced by a client-supplied price', () => {
    // A tampered body carrying a price field is simply ignored: the type has no
    // such field and validateCart never reads one.
    const tampered = [{ menuItemId: 'item-1', quantity: 1, unitPriceCents: 1 } as never];
    const cart = validateCart(tampered, menu(item()), null);
    expect(cart.items[0]!.unitPriceCents).toBe(2450);
  });

  it('refuses sold-out items and names them', () => {
    try {
      validateCart([{ menuItemId: 'item-1', quantity: 1 }], menu(item({ isAvailable: false })), null);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('ITEMS_UNAVAILABLE');
      expect((e as DomainError).details.items).toEqual([
        { menuItemId: 'item-1', nameEn: 'Beef Noodle Soup' },
      ]);
    }
  });

  it('refuses inactive or unknown items', () => {
    expect(() => validateCart([{ menuItemId: 'nope', quantity: 1 }], menu(item()), null)).toThrow(
      DomainError,
    );
    expect(() =>
      validateCart([{ menuItemId: 'item-1', quantity: 1 }], menu(item({ isActive: false })), null),
    ).toThrow(DomainError);
  });

  it('merges duplicate lines so quantity diffs stay unambiguous', () => {
    const cart = validateCart(
      [
        { menuItemId: 'item-1', quantity: 1 },
        { menuItemId: 'item-1', quantity: 2 },
      ],
      menu(item()),
      null,
    );
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(3);
  });

  it('rejects empty carts and impossible quantities', () => {
    expect(() => validateCart([], menu(item()), null)).toThrow(DomainError);
    for (const quantity of [0, -1, 1.5, 100]) {
      expect(() =>
        validateCart([{ menuItemId: 'item-1', quantity }], menu(item()), null),
      ).toThrow(DomainError);
    }
  });
});

describe('special request field', () => {
  it('keeps a normal free-text request', () => {
    expect(cleanNote('No coriander, please.')).toBe('No coriander, please.');
  });

  it('normalises blank input to null', () => {
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote(null)).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
  });

  it('strips control characters', () => {
    const withControls = ['no', String.fromCharCode(0), ' peanuts', String.fromCharCode(7)].join('');
    expect(cleanNote(withControls)).toBe('no peanuts');
  });

  it('enforces the length cap', () => {
    expect(() => cleanNote('x'.repeat(501))).toThrow(DomainError);
    expect(cleanNote('x'.repeat(500))).toHaveLength(500);
  });

  it('keeps non-Latin scripts intact', () => {
    expect(cleanNote('Không rau mùi')).toBe('Không rau mùi');
    expect(cleanNote('Bitte ohne Erdnüsse')).toBe('Bitte ohne Erdnüsse');
  });
});
