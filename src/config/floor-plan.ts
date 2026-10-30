import { RESTAURANT_LOCATION, type RestaurantLocation } from './restaurant';

/**
 * Where each table physically stands, one plan per restaurant, from each
 * restaurant's own floor drawing and their corrections to it.
 *
 * Coordinates are grid cells, not measurements. The point is that a waiter
 * glancing at the tablet recognises the room — in Oerlikon the buffet on the
 * left, the 50–53 strip by the entrance, 21 and 22 in the far corner — rather
 * than translating a number into a place in their head.
 *
 * A table missing from this map is NOT hidden: the dashboard lists it
 * separately, because a table that disappears from the screen is a table whose
 * guests get forgotten.
 */
export interface FloorPosition {
  readonly col: number;
  readonly row: number;
}

/**
 * Some rows are thin: they hold a room divider rather than tables. Keeping them
 * as real rows means a divider sits BETWEEN two rows of tables, which is where
 * the physical screen actually is.
 */
export type FloorRowKind = 'tables' | 'divider';

/** Fixed features of the room, drawn so the plan is recognisable. */
export interface FloorFixture {
  readonly label: string;
  readonly col: number;
  readonly row: number;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly kind: 'buffet' | 'bar' | 'entrance' | 'landmark' | 'plant' | 'divider';
}

export interface FloorLayout {
  readonly columns: number;
  readonly rowKinds: readonly FloorRowKind[];
  readonly positions: Readonly<Record<string, FloorPosition>>;
  readonly fixtures: readonly FloorFixture[];
  /**
   * The pairs of tables that can be pushed together. Without it, neighbours are
   * read off the grid (see `areNeighbours`). A room where the drawing cannot
   * say it — fixed booths beside movable tables, a plant between two tables in
   * a line — lists them instead, which is also a list the restaurant can check
   * line by line.
   */
  readonly joinable?: readonly (readonly [string, string])[];
}

const OERLIKON: FloorLayout = {
  columns: 9,
  rowKinds: [
    'divider', // 0 — partition behind 21/22
    'tables', // 1 — 21, 22
    'tables', // 2 — 18, 17, 16, 15
    'divider', // 3 — screen between 15 and 12
    'tables', // 4 — 20, 12
    'tables', // 5 — 19, 14, 13, 9
    'divider', // 6 — screen between 13/14 and 11/10
    'tables', // 7 — 11, 10, 4
    'tables', // 8 — the 50–53 strip
  ],

  /** Inside tables, as drawn. Outside tables are listed separately. */
  positions: {
    // Far corner, behind the partition.
    '21': { col: 5, row: 1 },
    '22': { col: 6, row: 1 },

    // The long row facing it.
    '18': { col: 5, row: 2 },
    '17': { col: 6, row: 2 },
    '16': { col: 7, row: 2 },
    '15': { col: 8, row: 2 },

    '20': { col: 4, row: 4 },
    '12': { col: 8, row: 4 },

    // 13 sits beside 14, not on its own row.
    '19': { col: 4, row: 5 },
    '14': { col: 5, row: 5 },
    '13': { col: 6, row: 5 },
    '9': { col: 8, row: 5 },

    '11': { col: 5, row: 7 },
    '10': { col: 6, row: 7 },
    '4': { col: 8, row: 7 },

    // The strip along the wall by the entrance.
    '53': { col: 4, row: 8 },
    '52': { col: 5, row: 8 },
    '51': { col: 6, row: 8 },
    '50': { col: 7, row: 8 },
  },

  fixtures: [
    { label: 'Buffet', col: 2, row: 2, rowSpan: 5, kind: 'buffet' },
    { label: 'Entrance', col: 2, row: 8, colSpan: 2, kind: 'entrance' },

    // Partition behind 21 and 22.
    { label: '', col: 5, row: 0, colSpan: 4, kind: 'divider' },
    // Screen between 15 and 12.
    { label: '', col: 8, row: 3, kind: 'divider' },
    // Screen between the 13/14 row and the 11/10 row.
    { label: '', col: 5, row: 6, colSpan: 2, kind: 'divider' },
  ],
};

/**
 * Winterthur, from the laminated plan the floor staff use, kept the same way
 * up: the hall at the top, the bar and the stairs in the middle, the mall
 * entrance at the bottom left.
 *
 * The hundreds are areas — 1xx the hall, 2xx the high tables and the bar, 3xx
 * the mall side. Rows are squeezed where the paper has empty space, so the plan
 * stays recognisable without being to scale. Every table is inside, the mall
 * side included, and every one is placed.
 */
const WINTERTHUR: FloorLayout = {
  columns: 10,
  rowKinds: [
    'tables', // 0 — 119
    'tables', // 1 — 118 · 125 · 136
    'tables', // 2 — 117
    'tables', // 3 — 116 · 124 · 135
    'tables', // 4 — 115
    'tables', // 5 — 114 · 134
    'tables', // 6 — 113 · 123
    'tables', // 7 — 112 · 133
    'tables', // 8 — 111 · 122 · 132
    'tables', // 9 — 121 · 131
    'tables', // 10 — 110 · 120 · 130
    'tables', // 11 — lift · 233 · bar
    'tables', // 12 — stairs · 232
    'tables', // 13 — stairs · 231
    'tables', // 14 — 211 · 221 · 230
    'tables', // 15 — 210 · 220 · 333 · 332 · 331 · 330
    'tables', // 16 — 325 · 324 · 323 · 322 · peach tree · 321 · 320
    'tables', // 17 — entrance · 313 · 312 · 311 · 310
  ],

  positions: {
    // Two-person tables along the left wall of the hall.
    '119': { col: 3, row: 0 },
    '118': { col: 3, row: 1 },
    '117': { col: 3, row: 2 },
    '116': { col: 3, row: 3 },
    '115': { col: 3, row: 4 },
    '114': { col: 3, row: 5 },
    '113': { col: 3, row: 6 },
    '112': { col: 3, row: 7 },

    // The round booth below them.
    '111': { col: 4, row: 8 },
    '110': { col: 4, row: 10 },

    // Four-person tables down the middle.
    '125': { col: 6, row: 1 },
    '124': { col: 6, row: 3 },
    '123': { col: 6, row: 6 },
    '122': { col: 6, row: 8 },
    '121': { col: 6, row: 9 },
    '120': { col: 6, row: 10 },

    // Booths along the window.
    '136': { col: 8, row: 1 },
    '135': { col: 8, row: 3 },
    '134': { col: 8, row: 5 },
    '133': { col: 8, row: 7 },
    '132': { col: 8, row: 8 },
    '131': { col: 8, row: 9 },
    '130': { col: 8, row: 10 },

    // Seats at the bar.
    '233': { col: 5, row: 11 },
    '232': { col: 5, row: 12 },
    '231': { col: 5, row: 13 },
    '230': { col: 5, row: 14 },

    // High tables beside the stairs.
    '211': { col: 1, row: 14 },
    '221': { col: 2, row: 14 },
    '210': { col: 1, row: 15 },
    '220': { col: 2, row: 15 },

    // Mall side.
    '333': { col: 5, row: 15 },
    '332': { col: 8, row: 15 },
    '331': { col: 9, row: 15 },
    '330': { col: 10, row: 15 },

    '325': { col: 4, row: 16 },
    '324': { col: 5, row: 16 },
    '323': { col: 6, row: 16 },
    '322': { col: 7, row: 16 },
    '321': { col: 9, row: 16 },
    '320': { col: 10, row: 16 },

    '313': { col: 5, row: 17 },
    '312': { col: 8, row: 17 },
    '311': { col: 9, row: 17 },
    '310': { col: 10, row: 17 },
  },

  fixtures: [
    { label: 'Lift · WC', col: 3, row: 11, colSpan: 2, kind: 'landmark' },
    { label: 'Bar', col: 6, row: 11, colSpan: 2, rowSpan: 4, kind: 'bar' },
    { label: 'Stairs', col: 1, row: 12, colSpan: 3, rowSpan: 2, kind: 'landmark' },
    { label: 'Entrance · Mall', col: 1, row: 17, colSpan: 2, kind: 'entrance' },
    // The tree between the long table and 321, which is why 322 and 321 never join.
    { label: 'Peach tree', col: 8, row: 16, kind: 'plant' },
  ],

  // The restaurant's rule, 2026-10-24: square tables can be joined, round ones
  // cannot. So the round booth (110, 111) and the round high tables (210, 211,
  // 220, 221) join nothing. Nothing joins across an aisle.
  joinable: [
    // A run along the left wall.
    ['119', '118'],
    ['118', '117'],
    ['117', '116'],
    ['116', '115'],
    ['115', '114'],
    ['114', '113'],
    ['113', '112'],

    // End to end down the middle.
    ['125', '124'],
    ['124', '123'],
    ['123', '122'],
    ['122', '121'],
    ['121', '120'],

    // Neighbouring booths along the window.
    ['136', '135'],
    ['135', '134'],
    ['134', '133'],
    ['133', '132'],
    ['132', '131'],
    ['131', '130'],

    // Neighbouring seats at the bar.
    ['233', '232'],
    ['232', '231'],
    ['231', '230'],

    // Each long bench holds two tables.
    ['333', '332'],
    ['313', '312'],

    // The long table.
    ['325', '324'],
    ['324', '323'],
    ['323', '322'],

    // The two-person tables by the window, side by side and front to back.
    ['331', '330'],
    ['321', '320'],
    ['311', '310'],
    ['331', '321'],
    ['321', '311'],
    ['330', '320'],
    ['320', '310'],
  ],
};

export const FLOOR_LAYOUTS: Readonly<Record<RestaurantLocation, FloorLayout>> = {
  oerlikon: OERLIKON,
  winterthur: WINTERTHUR,
};

/** This deployment's room. */
export const FLOOR_LAYOUT = FLOOR_LAYOUTS[RESTAURANT_LOCATION];

export const FLOOR_ROW_KINDS = FLOOR_LAYOUT.rowKinds;
export const FLOOR_COLUMNS = FLOOR_LAYOUT.columns;
export const FLOOR_ROWS = FLOOR_ROW_KINDS.length;
export const TABLE_POSITIONS = FLOOR_LAYOUT.positions;
export const FLOOR_FIXTURES = FLOOR_LAYOUT.fixtures;

export function positionFor(
  tableNumber: string,
  layout: FloorLayout = FLOOR_LAYOUT,
): FloorPosition | null {
  return layout.positions[tableNumber] ?? null;
}

/**
 * Whether two tables can be pushed together.
 *
 * A room that lists its `joinable` pairs is taken at its word. Otherwise
 * neighbours share an edge on the plan: side by side in the same row, or one
 * behind the other in the same column. A thin divider row counts as a gap
 * rather than a separation, so two tables either side of empty space are still
 * neighbours — but a table is NOT a neighbour of one on the far side of a
 * physical divider, because you cannot push a table through a screen.
 *
 * Diagonals do not count. Two tables meeting at a corner are not pushed
 * together in practice, and allowing it would make "neighbouring" mean very
 * little.
 */
export function areNeighbours(a: string, b: string, layout: FloorLayout = FLOOR_LAYOUT): boolean {
  if (a === b) return false;
  if (layout.joinable) {
    return layout.joinable.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }

  const posA = positionFor(a, layout);
  const posB = positionFor(b, layout);
  if (!posA || !posB) return false;

  // Side by side.
  if (posA.row === posB.row) return Math.abs(posA.col - posB.col) === 1;

  // One behind the other, allowing a thin divider row to sit between them.
  if (posA.col !== posB.col) return false;
  const [top, bottom] = posA.row < posB.row ? [posA, posB] : [posB, posA];
  if (bottom.row - top.row > 2) return false;

  // Every row strictly between them must be empty of a divider in this column.
  for (let row = top.row + 1; row < bottom.row; row += 1) {
    if (layout.rowKinds[row] === 'tables') return false; // a table row we skipped
    const blocked = layout.fixtures.some(
      (f) =>
        f.kind === 'divider' &&
        f.row === row &&
        posA.col >= f.col &&
        posA.col <= f.col + (f.colSpan ?? 1) - 1,
    );
    if (blocked) return false;
  }
  return true;
}

/**
 * A selection is mergeable when it forms one connected run — every table
 * touching at least one other in the set. Without this, a waiter could select
 * two pairs at opposite ends of the room and call it one table.
 */
export function isConnectedSelection(
  tableNumbers: readonly string[],
  layout: FloorLayout = FLOOR_LAYOUT,
): boolean {
  if (tableNumbers.length < 2) return false;
  const remaining = new Set(tableNumbers.slice(1));
  const reached = [tableNumbers[0]!];

  while (reached.length > 0) {
    const current = reached.pop()!;
    for (const candidate of [...remaining]) {
      if (areNeighbours(current, candidate, layout)) {
        remaining.delete(candidate);
        reached.push(candidate);
      }
    }
  }
  return remaining.size === 0;
}
