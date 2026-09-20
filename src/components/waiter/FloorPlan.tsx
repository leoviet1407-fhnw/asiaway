'use client';

import Link from 'next/link';
import {
  FLOOR_COLUMNS,
  FLOOR_FIXTURES,
  FLOOR_ROW_KINDS,
  positionFor,
} from '../../config/floor-plan';
import { formatElapsed, formatMoney } from '../../lib/format';

export interface FloorTable {
  tableId: string;
  tableNumber: string;
  area: 'INSIDE' | 'OUTSIDE' | null;
  state: 'AVAILABLE' | 'OCCUPIED' | 'ORDER_PENDING' | 'CHECKOUT_REQUESTED';
  sessionId: string | null;
  openedAt: string | null;
  pendingOrders: number;
  orderCount: number;
  sessionTotalCents: number;
}

const STATE_STYLE: Record<FloorTable['state'], string> = {
  AVAILABLE: 'border-ink/15 bg-surface text-ink',
  OCCUPIED: 'border-brand-500/50 bg-brand-50 text-ink',
  ORDER_PENDING: 'border-warn-500/60 bg-warn-50 text-ink',
  CHECKOUT_REQUESTED: 'border-danger-500/60 bg-danger-50 text-ink',
};

const FIXTURE_STYLE: Record<string, string> = {
  buffet: 'rounded-full border border-dashed border-ink/25 bg-surface-sunken text-ink-muted',
  entrance: 'rounded-xl border border-dashed border-ink/25 text-ink-muted',
  // A room divider is a solid screen between two runs of tables.
  divider: 'self-center h-1 w-full rounded-full bg-ink/30',
};

function href(table: FloorTable): string {
  // A seated table opens its session; a free one goes straight to the order pad,
  // because a free table is exactly where a waiter is about to take an order.
  return table.sessionId
    ? `/waiter/sessions/${table.sessionId}`
    : `/waiter/order?tableId=${table.tableId}`;
}

function Tile({ table }: { table: FloorTable }) {
  return (
    <Link
      href={href(table)}
      aria-label={`Table ${table.tableNumber}, ${table.state.replace('_', ' ').toLowerCase()}`}
      className={`flex h-full min-h-16 flex-col justify-center rounded-xl border px-1 py-1
                  text-center transition-colors ${STATE_STYLE[table.state]}`}
    >
      <span className="text-lg font-bold leading-none">{table.tableNumber}</span>
      {table.pendingOrders > 0 ? (
        <span className="mt-0.5 text-[11px] font-semibold leading-tight text-warn-500">
          {table.pendingOrders} waiting
        </span>
      ) : table.sessionId ? (
        <span className="mt-0.5 text-[11px] leading-tight text-ink-muted">
          {formatMoney(table.sessionTotalCents)}
          {table.openedAt && <> · {formatElapsed(table.openedAt)}</>}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The dining room as drawn, rather than a uniform grid of numbers.
 *
 * Tables keep their real positions so a waiter can look at the tablet and at
 * the room and see the same thing. Colour carries state, exactly as in the
 * list, so nothing new has to be learned.
 */
export function FloorPlan({ tables }: { tables: FloorTable[] }) {
  const placed = tables.filter((t) => positionFor(t.tableNumber));
  const outside = tables.filter((t) => t.area === 'OUTSIDE');
  // Anything neither placed nor outside must still be reachable.
  const unplaced = tables.filter(
    (t) => !positionFor(t.tableNumber) && t.area !== 'OUTSIDE',
  );

  return (
    <div className="space-y-5">
      <section aria-label="Dining room plan">
        <div className="overflow-x-auto pb-1">
          <div
            className="grid min-w-[36rem] gap-1.5"
            style={{
              gridTemplateColumns: `repeat(${FLOOR_COLUMNS}, minmax(3.25rem, 1fr))`,
              // Divider rows are thin, so a screen sits between two rows of
              // tables rather than taking a table's worth of space.
              gridTemplateRows: FLOOR_ROW_KINDS.map((kind) =>
                kind === 'divider' ? '0.75rem' : 'minmax(3.5rem, auto)',
              ).join(' '),
            }}
          >
            {FLOOR_FIXTURES.map((fixture) => (
              <div
                key={`${fixture.kind}-${fixture.col}-${fixture.row}`}
                aria-hidden="true"
                style={{
                  gridColumn: `${fixture.col} / span ${fixture.colSpan ?? 1}`,
                  gridRow: `${fixture.row + 1} / span ${fixture.rowSpan ?? 1}`,
                }}
                className={`flex items-center justify-center text-[11px] uppercase
                            tracking-wide ${FIXTURE_STYLE[fixture.kind]}`}
              >
                {fixture.kind === 'buffet' ? (
                  <span className="[writing-mode:vertical-rl] rotate-180">{fixture.label}</span>
                ) : (
                  fixture.label
                )}
              </div>
            ))}

            {placed.map((table) => {
              const pos = positionFor(table.tableNumber)!;
              return (
                <div
                  key={table.tableId}
                  style={{ gridColumn: pos.col, gridRow: pos.row + 1 }}
                >
                  <Tile table={table} />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {outside.length > 0 && (
        <section aria-label="Outside tables">
          <h3 className="mb-2 h-label">Outside</h3>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
            {outside.map((table) => (
              <Tile key={table.tableId} table={table} />
            ))}
          </div>
        </section>
      )}

      {unplaced.length > 0 && (
        <section aria-label="Tables not on the plan">
          <h3 className="mb-2 h-label">Not on the plan</h3>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
            {unplaced.map((table) => (
              <Tile key={table.tableId} table={table} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
