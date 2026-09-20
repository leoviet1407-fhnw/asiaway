'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  FLOOR_COLUMNS,
  FLOOR_FIXTURES,
  FLOOR_ROW_KINDS,
  isConnectedSelection,
  positionFor,
} from '../../config/floor-plan';
import { formatElapsed, formatMoney } from '../../lib/format';

export interface TableGroup {
  groupId: string;
  anchorTableId: string | null;
  tables: string[];
}

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

function href(table: FloorTable, shared: FloorTable | null): string {
  // A seated table opens its session; a free one goes straight to the order pad,
  // because a free table is exactly where a waiter is about to take an order.
  //
  // A table joined to others follows the party's shared bill, so tapping any of
  // them lands on the same session rather than on an empty pad.
  const session = table.sessionId ?? shared?.sessionId ?? null;
  return session ? `/waiter/sessions/${session}` : `/waiter/order?tableId=${table.tableId}`;
}

function Tile({
  table,
  shared = null,
  groupLabel,
  selectable,
  selected,
  onSelect,
}: {
  table: FloorTable;
  /** The table holding the bill, when this one is joined to others. */
  shared?: FloorTable | null;
  groupLabel?: string | null;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (table: FloorTable) => void;
}) {
  // Joined tables are one party, so they carry one colour. Only the table
  // holding the bill has a session, so without this the other half of a party
  // with an order waiting still looks empty.
  const state = shared?.state ?? table.state;
  const pendingOrders = shared?.pendingOrders ?? table.pendingOrders;
  const sessionId = shared?.sessionId ?? table.sessionId;
  const openedAt = shared?.openedAt ?? table.openedAt;
  const sessionTotalCents = shared?.sessionTotalCents ?? table.sessionTotalCents;
  const body = (
    <>
      <span className="text-lg font-bold leading-none">{table.tableNumber}</span>
      {groupLabel && (
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
          {groupLabel}
        </span>
      )}
      {pendingOrders > 0 ? (
        <span className="mt-0.5 text-[11px] font-semibold leading-tight text-warn-500">
          {pendingOrders} waiting
        </span>
      ) : sessionId ? (
        <span className="mt-0.5 text-[11px] leading-tight text-ink-muted">
          {/* The total is the party's, so it is shown once, on the table that
              holds the bill, rather than repeated on each joined table. */}
          {shared ? formatElapsed(openedAt ?? '') : formatMoney(sessionTotalCents)}
          {!shared && openedAt && <> · {formatElapsed(openedAt)}</>}
        </span>
      ) : null}
    </>
  );

  const shell = `flex h-full min-h-16 w-full flex-col justify-center rounded-xl border px-1 py-1
                 text-center transition-colors`;

  if (selectable) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect?.(table)}
        className={`${shell} ${
          selected ? 'border-brand-600 bg-brand-600 text-white' : STATE_STYLE[state]
        }`}
      >
        {body}
      </button>
    );
  }

  return (
    <Link
      href={href(table, shared)}
      aria-label={`Table ${table.tableNumber}, ${state.replace('_', ' ').toLowerCase()}${
        shared ? `, joined with table ${shared.tableNumber}` : ''
      }`}
      className={`${shell} ${STATE_STYLE[state]}`}
    >
      {body}
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
export function FloorPlan({
  tables,
  groups = [],
  onChanged,
}: {
  tables: FloorTable[];
  groups?: TableGroup[];
  onChanged?: () => void;
}) {
  const [merging, setMerging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupOf = (tableNumber: string) =>
    groups.find((g) => g.tables.includes(tableNumber)) ?? null;

  /**
   * The table carrying a joined party's bill, for any table that is not itself
   * that table. Null when the table stands alone, so it keeps its own state.
   */
  const sharedWith = (table: FloorTable): FloorTable | null => {
    const group = groupOf(table.tableNumber);
    if (!group || group.anchorTableId === table.tableId) return null;
    return tables.find((t) => t.tableId === group.anchorTableId) ?? null;
  };

  const selectedNumbers = selected
    .map((id) => tables.find((t) => t.tableId === id)?.tableNumber)
    .filter((n): n is string => Boolean(n));

  const connected = isConnectedSelection(selectedNumbers);

  const toggle = (table: FloorTable) => {
    setError(null);
    setSelected((current) =>
      current.includes(table.tableId)
        ? current.filter((id) => id !== table.tableId)
        : [...current, table.tableId],
    );
  };

  async function merge() {
    if (busy || selected.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/waiter/table-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableIds: selected }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error?.message ?? 'Those tables could not be joined.');
        return;
      }
      setSelected([]);
      setMerging(false);
      onChanged?.();
    } catch {
      setError('No connection. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  async function separate(groupId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/waiter/table-groups/${groupId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        setError(data?.error?.message ?? 'Those tables could not be separated.');
        return;
      }
      onChanged?.();
    } catch {
      setError('No connection. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  const placed = tables.filter((t) => positionFor(t.tableNumber));
  const outside = tables.filter((t) => t.area === 'OUTSIDE');
  // Anything neither placed nor outside must still be reachable.
  const unplaced = tables.filter(
    (t) => !positionFor(t.tableNumber) && t.area !== 'OUTSIDE',
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={merging ? 'btn-primary px-3 py-2 text-sm' : 'btn-secondary px-3 py-2 text-sm'}
          onClick={() => {
            setMerging((m) => !m);
            setSelected([]);
            setError(null);
          }}
        >
          {merging ? 'Cancel' : 'Join tables'}
        </button>

        {merging && (
          <>
            <span className="text-sm text-ink-muted">
              {selected.length === 0
                ? 'Tap the tables that are pushed together.'
                : `${selectedNumbers.sort((a, b) => Number(a) - Number(b)).join(' + ')}`}
            </span>
            <button
              type="button"
              className="btn-primary px-3 py-2 text-sm"
              disabled={busy || selected.length < 2 || !connected}
              onClick={() => void merge()}
            >
              {selected.length < 2
                ? 'Pick two or more'
                : !connected
                  ? 'Must be next to each other'
                  : `Join ${selected.length} tables`}
            </button>
          </>
        )}

        {groups.map((group) => (
          <span key={group.groupId} className="flex items-center gap-1">
            <span className="chip bg-brand-50 text-brand-700">
              Joined: {group.tables.join(' + ')}
            </span>
            <button
              type="button"
              className="min-h-tap px-2 text-sm font-semibold text-brand-700"
              disabled={busy}
              onClick={() => void separate(group.groupId)}
            >
              Separate
            </button>
          </span>
        ))}
      </div>

      {error && (
        <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}

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
                  <Tile
                    table={table}
                    shared={sharedWith(table)}
                    groupLabel={(() => {
                      const g = groupOf(table.tableNumber);
                      if (!g) return null;
                      return g.anchorTableId === table.tableId ? 'joined ·' : 'joined';
                    })()}
                    selectable={merging}
                    selected={selected.includes(table.tableId)}
                    onSelect={toggle}
                  />
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
