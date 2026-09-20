import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  isOrderEditable,
  isOrderPending,
  toCustomerVisibleState,
  transitionOrder,
  type OrderStatus,
  type OrderTransition,
} from '../../src/domain/order/status';
import { DomainError } from '../../src/domain/errors';

describe('order state machine', () => {
  it('walks the happy path', () => {
    expect(transitionOrder('SUBMITTED', 'OPEN_FOR_REVIEW')).toBe('EMPLOYEE_REVIEW');
    expect(transitionOrder('EMPLOYEE_REVIEW', 'CONFIRM')).toBe('CONFIRMED');
  });

  it('requires a review step before confirmation', () => {
    expect(() => transitionOrder('SUBMITTED', 'CONFIRM')).toThrow(DomainError);
  });

  it('treats re-opening an order already under review as a no-op', () => {
    expect(transitionOrder('EMPLOYEE_REVIEW', 'OPEN_FOR_REVIEW')).toBe('EMPLOYEE_REVIEW');
  });

  it('makes CONFIRMED and CANCELLED terminal', () => {
    const transitions: OrderTransition[] = ['OPEN_FOR_REVIEW', 'CONFIRM', 'CANCEL'];
    for (const terminal of ['CONFIRMED', 'CANCELLED'] as OrderStatus[]) {
      for (const t of transitions) {
        expect(() => transitionOrder(terminal, t), `${terminal}/${t}`).toThrow(DomainError);
      }
    }
  });

  it('rejects every transition not in the machine', () => {
    const legal = new Set([
      'SUBMITTED|OPEN_FOR_REVIEW',
      'SUBMITTED|CANCEL',
      'EMPLOYEE_REVIEW|OPEN_FOR_REVIEW',
      'EMPLOYEE_REVIEW|CONFIRM',
      'EMPLOYEE_REVIEW|CANCEL',
    ]);
    const transitions: OrderTransition[] = ['OPEN_FOR_REVIEW', 'CONFIRM', 'CANCEL'];
    for (const from of ORDER_STATUSES) {
      for (const t of transitions) {
        const key = `${from}|${t}`;
        if (legal.has(key)) continue;
        expect(() => transitionOrder(from, t), key).toThrow(DomainError);
      }
    }
  });

  it('only allows edits before confirmation', () => {
    expect(isOrderEditable('SUBMITTED')).toBe(true);
    expect(isOrderEditable('EMPLOYEE_REVIEW')).toBe(true);
    expect(isOrderEditable('CONFIRMED')).toBe(false);
    expect(isOrderEditable('CANCELLED')).toBe(false);
  });

  it('keeps submitted and in-review orders in the pending queue', () => {
    expect(isOrderPending('SUBMITTED')).toBe(true);
    expect(isOrderPending('EMPLOYEE_REVIEW')).toBe(true);
    expect(isOrderPending('CONFIRMED')).toBe(false);
  });

  it('never exposes internal workflow statuses to the guest', () => {
    expect(toCustomerVisibleState('SUBMITTED')).toBe('RECEIVED');
    expect(toCustomerVisibleState('EMPLOYEE_REVIEW')).toBe('RECEIVED');
    expect(toCustomerVisibleState('CONFIRMED')).toBe('CONFIRMED');
  });
});
