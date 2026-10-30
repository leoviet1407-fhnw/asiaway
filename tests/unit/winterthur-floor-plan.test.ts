import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLOOR_LAYOUTS,
  areNeighbours,
  isConnectedSelection,
  positionFor,
} from '../../src/config/floor-plan';

const plan = FLOOR_LAYOUTS.winterthur;

const run = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

/** Every table on Winterthur's laminated plan: 45 of them. */
const TABLES = [
  ...run(110, 125),
  ...run(130, 136),
  '210',
  '211',
  '220',
  '221',
  ...run(230, 233),
  ...run(310, 313),
  ...run(320, 325),
  ...run(330, 333),
];

describe('Winterthur floor plan', () => {
  it('places every table on the paper plan exactly once', () => {
    expect(TABLES).toHaveLength(45);
    for (const table of TABLES) {
      expect(positionFor(table, plan), `table ${table} missing from the plan`).not.toBeNull();
    }
    expect(Object.keys(plan.positions)).toHaveLength(TABLES.length);
  });

  it('never puts two tables in the same spot', () => {
    const seen = new Set<string>();
    for (const [table, pos] of Object.entries(plan.positions)) {
      const key = `${pos.col},${pos.row}`;
      expect(seen.has(key), `${table} collides at ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('never puts a table under the bar, the stairs or the entrance', () => {
    for (const [table, pos] of Object.entries(plan.positions)) {
      for (const f of plan.fixtures) {
        const inside =
          pos.col >= f.col &&
          pos.col < f.col + (f.colSpan ?? 1) &&
          pos.row >= f.row &&
          pos.row < f.row + (f.rowSpan ?? 1);
        expect(inside, `${table} sits under ${f.label}`).toBe(false);
      }
    }
  });

  it('keeps every table and fixture inside the grid', () => {
    for (const [table, pos] of Object.entries(plan.positions)) {
      expect(pos.col, `${table} col`).toBeGreaterThanOrEqual(1);
      expect(pos.col, `${table} col`).toBeLessThanOrEqual(plan.columns);
      expect(pos.row, `${table} row`).toBeGreaterThanOrEqual(0);
      expect(pos.row, `${table} row`).toBeLessThan(plan.rowKinds.length);
      expect(plan.rowKinds[pos.row], `${table} sits on a divider row`).toBe('tables');
    }
    for (const f of plan.fixtures) {
      expect(f.col + (f.colSpan ?? 1) - 1, f.label).toBeLessThanOrEqual(plan.columns);
      expect(f.row + (f.rowSpan ?? 1) - 1, f.label).toBeLessThan(plan.rowKinds.length);
    }
  });

  it('keeps the hall the way up the paper is: wall tables 119 down to 112', () => {
    const wall = ['119', '118', '117', '116', '115', '114', '113', '112'].map(
      (n) => positionFor(n, plan)!,
    );
    expect(new Set(wall.map((p) => p.col)).size).toBe(1);
    for (let i = 1; i < wall.length; i += 1) {
      expect(wall[i]!.row).toBeGreaterThan(wall[i - 1]!.row);
    }
    // The mall side is at the bottom.
    expect(positionFor('313', plan)!.row).toBeGreaterThan(positionFor('110', plan)!.row);
  });

  it('draws the peach tree in the gap between 322 and 321', () => {
    const tree = plan.fixtures.find((f) => f.kind === 'plant');
    const [t322, t321] = [positionFor('322', plan)!, positionFor('321', plan)!];
    expect(tree).toMatchObject({ label: 'Peach tree', row: t322.row });
    expect(tree!.col).toBeGreaterThan(t322.col);
    expect(tree!.col).toBeLessThan(t321.col);
  });

  it('provisions exactly the tables on the plan, all of them inside', () => {
    const { tables } = JSON.parse(
      readFileSync(resolve(__dirname, '../../data/winterthur-tables.json'), 'utf8'),
    ) as { tables: { tableNumber: string; area?: string }[] };

    expect(tables.map((t) => t.tableNumber).sort()).toEqual([...TABLES].sort());
    for (const table of tables) {
      expect(table.area, `table ${table.tableNumber}`).toBe('INSIDE');
    }
  });
});

describe('which Winterthur tables can be pushed together', () => {
  it('only names tables that are on the plan, each pair once', () => {
    const seen = new Set<string>();
    for (const [a, b] of plan.joinable!) {
      expect(TABLES, a).toContain(a);
      expect(TABLES, b).toContain(b);
      expect(a).not.toBe(b);
      const key = [a, b].sort().join('+');
      expect(seen.has(key), `${key} listed twice`).toBe(false);
      seen.add(key);
    }
  });

  it('never joins a round table', () => {
    const round = ['110', '111', '210', '211', '220', '221'];
    for (const [a, b] of plan.joinable!) {
      expect(round, `${a}+${b}`).not.toContain(a);
      expect(round, `${a}+${b}`).not.toContain(b);
    }
  });

  it('joins the square tables down the middle and along the window', () => {
    expect(isConnectedSelection(['125', '124', '123', '122', '121', '120'], plan)).toBe(true);
    expect(isConnectedSelection(run(130, 136), plan)).toBe(true);
  });

  it('lets a party take a run of tables along the wall', () => {
    expect(isConnectedSelection(['119', '118', '117', '116'], plan)).toBe(true);
    expect(isConnectedSelection(['325', '324', '323', '322'], plan)).toBe(true);
  });

  it('is symmetric: the order the waiter taps them in does not matter', () => {
    expect(areNeighbours('118', '119', plan)).toBe(true);
    expect(areNeighbours('119', '118', plan)).toBe(true);
  });

  it('refuses tables that do not touch', () => {
    expect(areNeighbours('110', '111', plan)).toBe(false); // the round booth
    expect(areNeighbours('211', '221', plan)).toBe(false); // round high tables
    expect(areNeighbours('122', '132', plan)).toBe(false); // across the aisle
    expect(areNeighbours('136', '134', plan)).toBe(false); // not next to each other
    expect(areNeighbours('322', '321', plan)).toBe(false); // across the plant
    expect(isConnectedSelection(['119', '333'], plan)).toBe(false);
    expect(isConnectedSelection(['119', '118', '310'], plan)).toBe(false);
  });

  it('does not let the list change how Oerlikon is read', () => {
    expect(areNeighbours('18', '17', FLOOR_LAYOUTS.oerlikon)).toBe(true);
    expect(areNeighbours('15', '12', FLOOR_LAYOUTS.oerlikon)).toBe(false);
  });
});
