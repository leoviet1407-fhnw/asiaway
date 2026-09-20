/**
 * Where each table physically stands, taken from the restaurant's own floor
 * sketch.
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

export const FLOOR_COLUMNS = 9;
export const FLOOR_ROWS = 7;

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

  '20': { col: 4, row: 3 },
  '13': { col: 6, row: 3 },
  '12': { col: 8, row: 3 },

  '19': { col: 4, row: 4 },
  '14': { col: 5, row: 4 },
  '9': { col: 8, row: 4 },

  '11': { col: 5, row: 5 },
  '10': { col: 6, row: 5 },
  '4': { col: 8, row: 5 },

  // The strip along the wall by the entrance.
  '53': { col: 4, row: 6 },
  '52': { col: 5, row: 6 },
  '51': { col: 6, row: 6 },
  '50': { col: 7, row: 6 },
};

/** Fixed features of the room, drawn so the plan is recognisable. */
export interface FloorFixture {
  readonly label: string;
  readonly col: number;
  readonly row: number;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly kind: 'buffet' | 'entrance' | 'partition';
}

export const FLOOR_FIXTURES: readonly FloorFixture[] = [
  { label: 'Buffet', col: 2, row: 2, rowSpan: 4, kind: 'buffet' },
  { label: 'Entrance', col: 2, row: 6, colSpan: 2, kind: 'entrance' },
  { label: '', col: 5, row: 0, colSpan: 4, kind: 'partition' },
];

export function positionFor(tableNumber: string): FloorPosition | null {
  return TABLE_POSITIONS[tableNumber] ?? null;
}
