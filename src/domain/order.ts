import { domainError } from './errors';
import { canAccessLocation, isOrderer, type Principal } from './roles';

export type OrderStatus = 'DRAFT' | 'SUBMITTED' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: 'Entwurf',
  SUBMITTED: 'Zur Prüfung',
  SENT: 'Gesendet',
  PARTIALLY_RECEIVED: 'Teilweise geliefert',
  RECEIVED: 'Geliefert',
  CANCELLED: 'Storniert',
};

/** Every allowed move. Anything else is refused. */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['DRAFT', 'SENT', 'CANCELLED'],
  SENT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw domainError('ILLEGAL_TRANSITION', `Order cannot go from ${from} to ${to}`, { from, to });
  }
}

interface OrderRef {
  readonly status: OrderStatus;
  readonly locationId: string;
}

/** Staff edit drafts of their own locations; orderers also edit submitted orders. */
export function canEditOrder(p: Principal, order: OrderRef): boolean {
  if (order.status === 'DRAFT') return canAccessLocation(p, order.locationId);
  if (order.status === 'SUBMITTED') return isOrderer(p);
  return false;
}

export function canSubmitOrder(p: Principal, order: OrderRef): boolean {
  return order.status === 'DRAFT' && canAccessLocation(p, order.locationId);
}

export function canSendOrder(p: Principal, order: OrderRef): boolean {
  return order.status === 'SUBMITTED' && isOrderer(p);
}

export function canReceiveOrder(p: Principal, order: OrderRef): boolean {
  return (order.status === 'SENT' || order.status === 'PARTIALLY_RECEIVED') && canAccessLocation(p, order.locationId);
}

export function canCancelOrder(p: Principal, order: OrderRef): boolean {
  if (order.status === 'DRAFT') return canAccessLocation(p, order.locationId);
  return isOrderer(p) && canTransition(order.status, 'CANCELLED');
}

export interface PricedLine {
  readonly qty: number;
  readonly unitPriceCents: number;
}

export function lineTotalCents(line: PricedLine): number {
  return Math.round(line.qty * line.unitPriceCents);
}

export function orderTotalCents(lines: readonly PricedLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotalCents(l), 0);
}

/** Below the supplier's minimum: a warning, never a block. */
export function belowMinimum(totalCents: number, minOrderCents: number): boolean {
  return minOrderCents > 0 && totalCents < minOrderCents;
}

/** B-2026-0007 */
export function formatOrderNumber(year: number, sequence: number): string {
  return `B-${year}-${String(sequence).padStart(4, '0')}`;
}
