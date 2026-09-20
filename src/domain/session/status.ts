import { domainError } from '../errors';

/**
 * Table / dining-session lifecycle (master spec §5.2).
 *
 * AVAILABLE is deliberately NOT a stored status: a table is available exactly
 * when it has no open session, which a partial unique index enforces in SQL.
 * Storing it would allow the two to disagree.
 *
 *   OCCUPIED ⇄ ORDER_PENDING ──┐
 *        │           │         ├─▶ CHECKOUT_REQUESTED ──▶ CLOSED (terminal)
 *        └───────────┴─────────┘
 */
export const SESSION_STATUSES = [
  'OCCUPIED',
  'ORDER_PENDING',
  'CHECKOUT_REQUESTED',
  'CLOSED',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type SessionTransition =
  | 'ORDER_SUBMITTED'
  | 'ALL_ORDERS_RESOLVED'
  | 'REQUEST_CHECKOUT'
  | 'CLOSE';

export interface SessionTransitionContext {
  /** Waiter override for closing a session that still has unresolved orders. */
  readonly force?: boolean;
  /** Required whenever force is used — it is written to the audit trail. */
  readonly reason?: string | null;
}

export function isSessionOpen(status: SessionStatus): boolean {
  return status !== 'CLOSED';
}

/**
 * A checkout request must NOT close the session (master spec §5.3): the guest
 * may still order a coffee after asking for the bill, and only staff may close.
 */
export function transitionSession(
  from: SessionStatus,
  transition: SessionTransition,
  ctx: SessionTransitionContext = {},
): SessionStatus {
  if (from === 'CLOSED') {
    throw domainError('ILLEGAL_SESSION_TRANSITION', 'A closed session cannot change state', {
      from,
      transition,
    });
  }

  switch (transition) {
    case 'ORDER_SUBMITTED':
      // Keeps checkout_requested_at intact; the column, not the status, records
      // that the bill was asked for.
      return 'ORDER_PENDING';

    case 'ALL_ORDERS_RESOLVED':
      return from === 'CHECKOUT_REQUESTED' ? 'CHECKOUT_REQUESTED' : 'OCCUPIED';

    case 'REQUEST_CHECKOUT':
      return 'CHECKOUT_REQUESTED';

    case 'CLOSE': {
      if (from === 'ORDER_PENDING' && !ctx.force) {
        throw domainError(
          'SESSION_HAS_UNRESOLVED_ORDERS',
          'Session still has orders awaiting waiter action; close requires force + reason',
          { from },
        );
      }
      if (ctx.force && !ctx.reason?.trim()) {
        throw domainError('REASON_REQUIRED', 'A forced session close must record a reason', {
          from,
        });
      }
      return 'CLOSED';
    }
  }
}

/** What the waiter dashboard shows for a table. */
export type TableDisplayState =
  | 'AVAILABLE'
  | 'OCCUPIED'
  | 'ORDER_PENDING'
  | 'CHECKOUT_REQUESTED';

export function tableDisplayState(openSessionStatus: SessionStatus | null): TableDisplayState {
  if (openSessionStatus === null || openSessionStatus === 'CLOSED') return 'AVAILABLE';
  return openSessionStatus;
}
