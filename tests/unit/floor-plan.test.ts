import { describe, expect, it } from 'vitest';
import {
  FLOOR_COLUMNS,
  FLOOR_ROWS,
  TABLE_POSITIONS,
  positionFor,
} from '../../src/config/floor-plan';

/** The 22 real tables: 4, 9-22 and 50-53 inside, 30-32 outside. */
const INSIDE = ['4', ...Array.from({ length: 14 }, (_, i) => String(i + 9)), '50', '51', '52', '53'];
const OUTSIDE = ['30', '31', '32'];

describe('floor plan', () => {
  it('places every inside table exactly once', () => {
    for (const table of INSIDE) {
      expect(positionFor(table), `table ${table} missing from the plan`).not.toBeNull();
    }
    expect(Object.keys(TABLE_POSITIONS)).toHaveLength(INSIDE.length);
  });

  it('does not place outside tables, which are listed separately', () => {
    for (const table of OUTSIDE) {
      expect(positionFor(table), `table ${table}`).toBeNull();
    }
  });

  it('never puts two tables in the same spot', () => {
    const seen = new Set<string>();
    for (const [table, pos] of Object.entries(TABLE_POSITIONS)) {
      const key = `${pos.col},${pos.row}`;
      expect(seen.has(key), `${table} collides at ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('keeps every table inside the grid', () => {
    for (const [table, pos] of Object.entries(TABLE_POSITIONS)) {
      expect(pos.col, `${table} col`).toBeGreaterThanOrEqual(1);
      expect(pos.col, `${table} col`).toBeLessThanOrEqual(FLOOR_COLUMNS);
      expect(pos.row, `${table} row`).toBeGreaterThanOrEqual(1);
      expect(pos.row, `${table} row`).toBeLessThanOrEqual(FLOOR_ROWS);
    }
  });

  it('keeps 17 between 18 and 16, as the restaurant confirmed', () => {
    const [t18, t17, t16] = [positionFor('18')!, positionFor('17')!, positionFor('16')!];
    expect(t18.row).toBe(t17.row);
    expect(t17.row).toBe(t16.row);
    expect(t18.col).toBeLessThan(t17.col);
    expect(t17.col).toBeLessThan(t16.col);
  });

  it('keeps the 50-53 strip together in one row, in order', () => {
    const strip = ['53', '52', '51', '50'].map((n) => positionFor(n)!);
    expect(new Set(strip.map((p) => p.row)).size).toBe(1);
    for (let i = 1; i < strip.length; i += 1) {
      expect(strip[i]!.col).toBeGreaterThan(strip[i - 1]!.col);
    }
  });

  it('returns null for a table it has never heard of, rather than guessing', () => {
    expect(positionFor('999')).toBeNull();
    expect(positionFor('')).toBeNull();
  });
});
