import { domainError } from '../errors';

/**
 * Order lifecycle (master spec §5.1).
 *
 *   DRAFT lives ONLY in the customer's browser and is never persisted — a cart
 *   is not an order. Persisting it would put phantom orders in the waiter queue.
 *
 *   SUBMITTED ──open──▶ EMPLOYEE_REVIEW ──confirm──▶ CONFIRMED (terminal)
 *        │                     │
 *        └───────cancel────────┴──────▶ CANCELLED (terminal, waiter only)
 */
export const ORDER_STATUSES = ['SUBMITTED', 'EMPLOYEE_REVIEW', 'CONFIRMED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderTransition = 'OPEN_FOR_REVIEW' | 'CONFIRM' | 'CANCEL';

const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderTransition, OrderStatus>>> = {
  SUBMITTED: {
    OPEN_FOR_REVIEW: 'EMPLOYEE_REVIEW',
    CANCEL: 'CANCELLED',
  },
  EMPLOYEE_REVIEW: {
    // Re-opening an order already under review is a no-op, not an error: two
    // waiters tapping the same card must not produce a failure.
    OPEN_FOR_REVIEW: 'EMPLOYEE_REVIEW',
    CONFIRM: 'CONFIRMED',
    CANCEL: 'CANCELLED',
  },
  CONFIRMED: {},
  CANCELLED: {},
};

/** States in which the waiter may still change the order's contents. */
const EDITABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['SUBMITTED', 'EMPLOYEE_REVIEW']);

/** States that still occupy the waiter's pending queue. */
const PENDING: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['SUBMITTED', 'EMPLOYEE_REVIEW']);

export function isOrderEditable(status: OrderStatus): boolean {
  return EDITABLE.has(status);
}

export function isOrderPending(status: OrderStatus): boolean {
  return PENDING.has(status);
}

export function isOrderTerminal(status: OrderStatus): boolean {
  return status === 'CONFIRMED' || status === 'CANCELLED';
}

export function canTransitionOrder(from: OrderStatus, transition: OrderTransition): boolean {
  return TRANSITIONS[from][transition] !== undefined;
}

/**
 * Applies a transition or throws. Confirming requires a prior review step, so
 * the "waiter confirmed at the table" event in the audit trail is always
 * preceded by an "opened" event. The API layer may perform OPEN_FOR_REVIEW
 * automatically, but it must record both transitions.
 */
export function transitionOrder(from: OrderStatus, transition: OrderTransition): OrderStatus {
  const next = TRANSITIONS[from][transition];
  if (next === undefined) {
    throw domainError(
      'ILLEGAL_ORDER_TRANSITION',
      `Order cannot go ${from} --${transition}--> (no such transition)`,
      { from, transition },
    );
  }
  return next;
}

/** Guests never see these names (master spec: no internal statuses exposed). */
export type CustomerVisibleOrderState = 'RECEIVED' | 'CONFIRMED' | 'CANCELLED';

export function toCustomerVisibleState(status: OrderStatus): CustomerVisibleOrderState {
  switch (status) {
    case 'SUBMITTED':
    case 'EMPLOYEE_REVIEW':
      return 'RECEIVED';
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}
