import { describe, expect, it } from 'vitest';
import {
  FLOOR_COLUMNS,
  FLOOR_FIXTURES,
  FLOOR_ROWS,
  FLOOR_ROW_KINDS,
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

  it('puts 13 beside 14, in the same row', () => {
    const t13 = positionFor('13')!;
    const t14 = positionFor('14')!;
    expect(t13.row).toBe(t14.row);
    expect(Math.abs(t13.col - t14.col)).toBe(1);
  });

  it('puts a divider between the 13/14 row and the 11/10 row', () => {
    const above = positionFor('14')!.row;
    const below = positionFor('11')!.row;
    const divider = FLOOR_FIXTURES.find(
      (f) => f.kind === 'divider' && f.row > above && f.row < below,
    );
    expect(divider, 'no divider between 13/14 and 11/10').toBeDefined();
    // It has to actually span those tables' columns to read as a screen.
    expect(divider!.col).toBeLessThanOrEqual(positionFor('14')!.col);
    expect(divider!.col + (divider!.colSpan ?? 1) - 1).toBeGreaterThanOrEqual(
      positionFor('13')!.col,
    );
  });

  it('puts a divider between 15 and 12', () => {
    const above = positionFor('15')!.row;
    const below = positionFor('12')!.row;
    const divider = FLOOR_FIXTURES.find(
      (f) => f.kind === 'divider' && f.row > above && f.row < below,
    );
    expect(divider, 'no divider between 15 and 12').toBeDefined();
    expect(divider!.col).toBe(positionFor('12')!.col);
  });

  it('never places a table on a divider row', () => {
    for (const [table, pos] of Object.entries(TABLE_POSITIONS)) {
      expect(FLOOR_ROW_KINDS[pos.row], `${table} sits on a divider row`).toBe('tables');
    }
  });

  it('returns null for a table it has never heard of, rather than guessing', () => {
    expect(positionFor('999')).toBeNull();
    expect(positionFor('')).toBeNull();
  });
});
