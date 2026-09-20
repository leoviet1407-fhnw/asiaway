import { describe, expect, it } from 'vitest';
import { assignDishNumbers, splitBundledRow, type BundledRow } from '../../src/domain/menu/variants';

const curryRow: BundledRow = {
  category: 'Fish & Curry',
  dishNumber: '90',
  nameEn: 'Green Curry - Chicken / Tofu',
  nameDe: 'Grünes Curry – Poulet / Tofu',
  nameVi: 'Cà ri xanh – gà / đậu hũ',
  descriptionEn: 'Green curry with Thai eggplant',
  descriptionDe: 'Grünes Curry mit Thai-Auberginen',
  descriptionVi: 'Cà ri xanh',
  priceRaw: '25.5',
  allergensRaw: 'A D / A D F',
};

describe('bundled menu row splitting (decision E1)', () => {
  it('splits a two-protein curry into two orderable items with their own allergens', () => {
    const items = splitBundledRow(curryRow);
    expect(items).toHaveLength(2);
    expect(items[0]!.nameEn).toBe('Green Curry - Chicken');
    expect(items[0]!.allergensRaw).toBe('A D');
    expect(items[1]!.nameEn).toBe('Green Curry - Tofu');
    expect(items[1]!.allergensRaw).toBe('A D F');
  });

  it('preserves the en dash used by the German and Vietnamese rows', () => {
    const items = splitBundledRow(curryRow);
    expect(items[0]!.nameDe).toBe('Grünes Curry – Poulet');
    expect(items[1]!.nameDe).toBe('Grünes Curry – Tofu');
    expect(items[0]!.nameVi).toBe('Cà ri xanh – gà');
    expect(items[1]!.nameVi).toBe('Cà ri xanh – đậu hũ');
  });

  it('leaves a single-variant row alone', () => {
    const row: BundledRow = { ...curryRow, dishNumber: '11', nameEn: 'Kimchi', nameDe: 'Kimchi', nameVi: 'Kim chi Hàn Quốc', allergensRaw: 'B D O' };
    const items = splitBundledRow(row);
    expect(items).toHaveLength(1);
    expect(items[0]!.nameEn).toBe('Kimchi');
  });

  it('refuses to guess when names and allergens disagree', () => {
    expect(() => splitBundledRow({ ...curryRow, allergensRaw: 'A D / A D F / A B D' })).toThrow(/inconsistent/i);
  });

  it('refuses to split a name that has no variant separator', () => {
    expect(() => splitBundledRow({ ...curryRow, nameEn: 'Green Curry Chicken Tofu' })).toThrow(/variant separator/i);
  });

  it('numbers multi-variant dishes .1 .2 .3 and leaves single dishes plain', () => {
    const split = [
      ...splitBundledRow({ ...curryRow }),
      ...splitBundledRow({ ...curryRow, nameEn: 'Green Curry - Beef / Prawn', nameDe: 'Grünes Curry – Rindfleisch / Krevetten', nameVi: 'Cà ri xanh – bò / tôm', priceRaw: '27.5', allergensRaw: 'A D / A B D' }),
      ...splitBundledRow({ ...curryRow, dishNumber: '94', nameEn: 'Caramelized Fish', nameDe: 'Fisch', nameVi: 'Cá kho tộ', allergensRaw: 'D' }),
    ];
    const numbered = assignDishNumbers(split);
    expect(numbered.map((i) => i.displayDishNumber)).toEqual(['90.1', '90.2', '90.3', '90.4', '94']);
    expect(numbered.map((i) => i.nameEn)).toEqual([
      'Green Curry - Chicken',
      'Green Curry - Tofu',
      'Green Curry - Beef',
      'Green Curry - Prawn',
      'Caramelized Fish',
    ]);
  });
});
