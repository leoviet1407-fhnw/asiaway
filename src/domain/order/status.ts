import { domainError } from '../errors';

/**
 * Order lifecycle (master spec §5.1, amended — see ADR E13).
 *
 *   DRAFT lives ONLY in the customer's browser and is never persisted — a cart
 *   is not an order. Persisting it would put phantom orders in the waiter queue.
 *
 *   AWAITING_CUSTOMER ──finalise──▶ CONFIRMED ──reopen──▶ EMPLOYEE_REVIEW
 *        │  (60s, or the guest sends early)                     │
 *        └──────────────cancel──────────────┐                   │ confirm
 *                                           ▼                   ▼
 *   SUBMITTED ──open──▶ EMPLOYEE_REVIEW ──confirm──▶ CONFIRMED (no longer terminal)
 *        │                     │
 *        └───────cancel────────┴──────▶ CANCELLED (terminal, waiter only)
 *
 * The restaurant replaced the waiter's confirm step with a 60-second window in
 * which the guest may still change their own order; it then confirms itself and
 * reaches the waiter settled. Two consequences are deliberate:
 *
 *  - CONFIRMED is no longer terminal. A waiter can reopen a confirmed order,
 *    because the guest's only remaining way to fix a mistake is to ask staff.
 *  - SUBMITTED survives for orders placed before this change and for any path
 *    that still wants a waiter to review first. Nothing enters it today.
 */
export const ORDER_STATUSES = [
  'AWAITING_CUSTOMER',
  'SUBMITTED',
  'EMPLOYEE_REVIEW',
  'CONFIRMED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderTransition =
  | 'OPEN_FOR_REVIEW'
  | 'CONFIRM'
  | 'CANCEL'
  /** The guest's window closed, by the timer or because they sent it early. */
  | 'FINALISE'
  /** A waiter reopening a confirmed order at the guest's request. */
  | 'REOPEN';

const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderTransition, OrderStatus>>> = {
  AWAITING_CUSTOMER: {
    FINALISE: 'CONFIRMED',
    // Repeating a finalise is a no-op rather than an error: the guest's timer
    // and a waiter's dashboard read can both reach the same order at once.
    CANCEL: 'CANCELLED',
    // A waiter can still pull an order out of the window in an emergency.
    OPEN_FOR_REVIEW: 'EMPLOYEE_REVIEW',
  },
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
  // Reopening is the guest's only route to a correction once the window has
  // closed, so a confirmed order can go back for review. Cancelling stays a
  // waiter's decision.
  CONFIRMED: {
    REOPEN: 'EMPLOYEE_REVIEW',
    CANCEL: 'CANCELLED',
  },
  CANCELLED: {},
};

/** States in which the waiter may still change the order's contents. */
const EDITABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['SUBMITTED', 'EMPLOYEE_REVIEW']);

/**
 * States that still occupy the waiter's pending queue.
 *
 * AWAITING_CUSTOMER is deliberately absent: an order the guest is still editing
 * has not reached the waiter, and showing it would recreate exactly the
 * half-finished traffic this change removes.
 */
const PENDING: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['SUBMITTED', 'EMPLOYEE_REVIEW']);

/** Whether the guest may still change this order themselves. */
export function isCustomerEditable(status: OrderStatus): boolean {
  return status === 'AWAITING_CUSTOMER';
}

export function isOrderEditable(status: OrderStatus): boolean {
  return EDITABLE.has(status);
}

export function isOrderPending(status: OrderStatus): boolean {
  return PENDING.has(status);
}

export function isOrderTerminal(status: OrderStatus): boolean {
  // CONFIRMED is no longer terminal — a waiter can reopen it for the guest.
  return status === 'CANCELLED';
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
export type CustomerVisibleOrderState = 'EDITABLE' | 'RECEIVED' | 'CONFIRMED' | 'CANCELLED';

export function toCustomerVisibleState(status: OrderStatus): CustomerVisibleOrderState {
  switch (status) {
    // The one internal state the guest genuinely needs to act on: it is the
    // difference between "you can still change this" and "ask a waiter".
    case 'AWAITING_CUSTOMER':
      return 'EDITABLE';
    case 'SUBMITTED':
    case 'EMPLOYEE_REVIEW':
      return 'RECEIVED';
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}
