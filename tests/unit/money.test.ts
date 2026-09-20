import { describe, expect, it } from 'vitest';
import { formatCents, lineTotal, parsePriceToCents, sumCents, MoneyError } from '../../src/lib/money';

describe('money', () => {
  it('parses menu prices into Rappen', () => {
    expect(parsePriceToCents('12.5')).toBe(1250);
    expect(parsePriceToCents('8.50')).toBe(850);
    expect(parsePriceToCents('24')).toBe(2400);
    expect(parsePriceToCents('34.5')).toBe(3450);
    expect(parsePriceToCents(' 7.50 ')).toBe(750);
  });

  it('refuses ambiguous prices rather than rounding silently', () => {
    for (const bad of ['12.345', 'CHF 12', '', '-5', '12,50', 'free']) {
      expect(() => parsePriceToCents(bad), bad).toThrow(MoneyError);
    }
  });

  it('computes line and order totals in integers only', () => {
    expect(lineTotal(2450, 2)).toBe(4900);
    expect(sumCents([4900, 1250, 750])).toBe(6900);
  });

  it('rejects non-positive quantities', () => {
    expect(() => lineTotal(2450, 0)).toThrow(MoneyError);
    expect(() => lineTotal(2450, 1.5)).toThrow(MoneyError);
  });

  it('avoids the float error that a naive implementation would make', () => {
    // 0.1 + 0.2 style drift: 19.90 * 3 must be exactly 59.70
    expect(lineTotal(parsePriceToCents('19.90'), 3)).toBe(5970);
  });

  it('formats for display in Swiss French/German convention', () => {
    expect(formatCents(2450)).toMatch(/24\.50/);
  });
});
