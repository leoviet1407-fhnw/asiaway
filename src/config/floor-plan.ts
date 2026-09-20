/**
 * Where each table physically stands, from the restaurant's floor sketch and
 * their corrections to it.
 *
 * Coordinates are grid cells, not measurements. The point is that a waiter
 * glancing at the tablet recognises the room — the buffet on the left, the
 * 50–53 strip by the entrance, 21 and 22 in the far corner — rather than
 * translating a number into a place in their head.
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
export const FLOOR_ROW_KINDS = [
  'divider', // 0 — partition behind 21/22
  'tables', // 1 — 21, 22
  'tables', // 2 — 18, 17, 16, 15
  'divider', // 3 — screen between 15 and 12
  'tables', // 4 — 20, 12
  'tables', // 5 — 19, 14, 13, 9
  'divider', // 6 — screen between 13/14 and 11/10
  'tables', // 7 — 11, 10, 4
  'tables', // 8 — the 50–53 strip
] as const;

export const FLOOR_COLUMNS = 9;
export const FLOOR_ROWS = FLOOR_ROW_KINDS.length;

/** Inside tables, as drawn. Outside tables are listed separately. */
export const TABLE_POSITIONS: Readonly<Record<string, FloorPosition>> = {
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
};

/** Fixed features of the room, drawn so the plan is recognisable. */
export interface FloorFixture {
  readonly label: string;
  readonly col: number;
  readonly row: number;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly kind: 'buffet' | 'entrance' | 'divider';
}

export const FLOOR_FIXTURES: readonly FloorFixture[] = [
  { label: 'Buffet', col: 2, row: 2, rowSpan: 5, kind: 'buffet' },
  { label: 'Entrance', col: 2, row: 8, colSpan: 2, kind: 'entrance' },

  // Partition behind 21 and 22.
  { label: '', col: 5, row: 0, colSpan: 4, kind: 'divider' },
  // Screen between 15 and 12.
  { label: '', col: 8, row: 3, kind: 'divider' },
  // Screen between the 13/14 row and the 11/10 row.
  { label: '', col: 5, row: 6, colSpan: 2, kind: 'divider' },
];

export function positionFor(tableNumber: string): FloorPosition | null {
  return TABLE_POSITIONS[tableNumber] ?? null;
}

/**
 * Whether two tables can be pushed together.
 *
 * Neighbours share an edge on the plan: side by side in the same row, or one
 * behind the other in the same column. A thin divider row counts as a gap
 * rather than a separation, so two tables either side of empty space are still
 * neighbours — but a table is NOT a neighbour of one on the far side of a
 * physical divider, because you cannot push a table through a screen.
 *
 * Diagonals do not count. Two tables meeting at a corner are not pushed
 * together in practice, and allowing it would make "neighbouring" mean very
 * little.
 */
export function areNeighbours(a: string, b: string): boolean {
  const posA = positionFor(a);
  const posB = positionFor(b);
  if (!posA || !posB || a === b) return false;

  // Side by side.
  if (posA.row === posB.row) return Math.abs(posA.col - posB.col) === 1;

  // One behind the other, allowing a thin divider row to sit between them.
  if (posA.col !== posB.col) return false;
  const [top, bottom] = posA.row < posB.row ? [posA, posB] : [posB, posA];
  if (bottom.row - top.row > 2) return false;

  // Every row strictly between them must be empty of a divider in this column.
  for (let row = top.row + 1; row < bottom.row; row += 1) {
    if (FLOOR_ROW_KINDS[row] === 'tables') return false; // a table row we skipped
    const blocked = FLOOR_FIXTURES.some(
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
export function isConnectedSelection(tableNumbers: readonly string[]): boolean {
  if (tableNumbers.length < 2) return false;
  const remaining = new Set(tableNumbers.slice(1));
  const reached = [tableNumbers[0]!];

  while (reached.length > 0) {
    const current = reached.pop()!;
    for (const candidate of [...remaining]) {
      if (areNeighbours(current, candidate)) {
        remaining.delete(candidate);
        reached.push(candidate);
      }
    }
  }
  return remaining.size === 0;
}
