import type { ChangeKind, OrderChange } from '../order/revision';

/**
 * The audit event catalogue. Every state-changing action that matters to the
 * restaurant appears here, and every one is written in the SAME transaction as
 * the change it describes, so state and history cannot drift apart.
 */
export const AUDIT_ACTIONS = [
  'SESSION_OPENED',
  'SESSION_CLOSED',
  'SESSION_FORCE_CLOSED',
  'CHECKOUT_REQUESTED',
  'ORDER_SUBMITTED',
  'ORDER_OPENED_FOR_REVIEW',
  'ORDER_ITEM_ADDED',
  'ORDER_ITEM_REMOVED',
  'ORDER_ITEM_QUANTITY_CHANGED',
  'ORDER_CUSTOMER_NOTE_CHANGED',
  'ORDER_WAITER_NOTE_CHANGED',
  'ORDER_CONFIRMED',
  'ORDER_CANCELLED',
  'MENU_ITEM_SOLD_OUT',
  'MENU_ITEM_RESTORED',
  'MENU_IMPORTED',
  'TABLE_GROUP_CREATED',
  'TABLE_GROUP_DISSOLVED',
  'QR_TOKEN_ROTATED',
  'USER_LOGIN_SUCCEEDED',
  'USER_LOGIN_FAILED',
  'NOTIFICATION_ACKNOWLEDGED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const ACTOR_TYPES = ['CUSTOMER', 'WAITER', 'SYSTEM'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export interface Actor {
  readonly type: ActorType;
  /** Waiter user id, or null for a guest device / the system. */
  readonly userId?: string | null;
  /** Anonymous per-device id for a guest. Never PII. */
  readonly deviceId?: string | null;
}

export type AuditEntityType =
  | 'ORDER'
  | 'SESSION'
  | 'MENU_ITEM'
  | 'TABLE'
  | 'TABLE_GROUP'
  | 'USER'
  | 'NOTIFICATION';

export interface AuditEventInput {
  readonly action: AuditAction;
  readonly actor: Actor;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
  readonly tableId?: string | null;
  readonly sessionId?: string | null;
  readonly orderId?: string | null;
  readonly beforeValue?: unknown;
  readonly afterValue?: unknown;
  readonly metadata?: Record<string, unknown>;
}

const CHANGE_TO_ACTION: Record<ChangeKind, AuditAction> = {
  ITEM_ADDED: 'ORDER_ITEM_ADDED',
  ITEM_REMOVED: 'ORDER_ITEM_REMOVED',
  ITEM_QUANTITY_CHANGED: 'ORDER_ITEM_QUANTITY_CHANGED',
  CUSTOMER_NOTE_CHANGED: 'ORDER_CUSTOMER_NOTE_CHANGED',
  WAITER_NOTE_CHANGED: 'ORDER_WAITER_NOTE_CHANGED',
  STATUS_CHANGED: 'ORDER_OPENED_FOR_REVIEW',
};

/** One audit event per change, each carrying its own before/after values. */
export function auditEventsForChanges(
  changes: readonly OrderChange[],
  context: {
    actor: Actor;
    orderId: string;
    sessionId: string;
    tableId: string;
    revisionNumber: number;
    reason?: string | null;
  },
): AuditEventInput[] {
  return changes.map((change) => ({
    action: CHANGE_TO_ACTION[change.kind],
    actor: context.actor,
    entityType: 'ORDER' as const,
    entityId: context.orderId,
    tableId: context.tableId,
    sessionId: context.sessionId,
    orderId: context.orderId,
    beforeValue: change.before,
    afterValue: change.after,
    metadata: {
      revisionNumber: context.revisionNumber,
      changeKind: change.kind,
      itemKey: change.itemKey ?? null,
      label: change.label ?? null,
      reason: context.reason ?? null,
    },
  }));
}
