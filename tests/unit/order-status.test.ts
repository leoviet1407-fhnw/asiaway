import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  isCustomerEditable,
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

  it('leaves the guest in control for the length of their window', () => {
    expect(transitionOrder('AWAITING_CUSTOMER', 'FINALISE')).toBe('CONFIRMED');
  });

  it('lets a waiter reopen a confirmed order, because the guest no longer can', () => {
    expect(transitionOrder('CONFIRMED', 'REOPEN')).toBe('EMPLOYEE_REVIEW');
    expect(transitionOrder('EMPLOYEE_REVIEW', 'CONFIRM')).toBe('CONFIRMED');
  });

  it('makes CANCELLED terminal', () => {
    const transitions: OrderTransition[] = [
      'OPEN_FOR_REVIEW',
      'CONFIRM',
      'CANCEL',
      'FINALISE',
      'REOPEN',
    ];
    for (const t of transitions) {
      expect(() => transitionOrder('CANCELLED', t), `CANCELLED/${t}`).toThrow(DomainError);
    }
  });

  it('never lets a confirmed order be confirmed or finalised again', () => {
    // Reopening is the only way back in; everything else must still be refused,
    // so a stray second finalise cannot mint another kitchen notification.
    expect(() => transitionOrder('CONFIRMED', 'CONFIRM')).toThrow(DomainError);
    expect(() => transitionOrder('CONFIRMED', 'FINALISE')).toThrow(DomainError);
    expect(() => transitionOrder('CONFIRMED', 'OPEN_FOR_REVIEW')).toThrow(DomainError);
  });

  it('rejects every transition not in the machine', () => {
    const legal = new Set([
      'AWAITING_CUSTOMER|FINALISE',
      'AWAITING_CUSTOMER|CANCEL',
      'AWAITING_CUSTOMER|OPEN_FOR_REVIEW',
      'SUBMITTED|OPEN_FOR_REVIEW',
      'SUBMITTED|CANCEL',
      'EMPLOYEE_REVIEW|OPEN_FOR_REVIEW',
      'EMPLOYEE_REVIEW|CONFIRM',
      'EMPLOYEE_REVIEW|CANCEL',
      'CONFIRMED|REOPEN',
      'CONFIRMED|CANCEL',
    ]);
    const transitions: OrderTransition[] = [
      'OPEN_FOR_REVIEW',
      'CONFIRM',
      'CANCEL',
      'FINALISE',
      'REOPEN',
    ];
    for (const from of ORDER_STATUSES) {
      for (const t of transitions) {
        const key = `${from}|${t}`;
        if (legal.has(key)) continue;
        expect(() => transitionOrder(from, t), key).toThrow(DomainError);
      }
    }
  });

  it('only lets the guest edit inside their own window', () => {
    expect(isCustomerEditable('AWAITING_CUSTOMER')).toBe(true);
    expect(isCustomerEditable('CONFIRMED')).toBe(false);
    expect(isCustomerEditable('EMPLOYEE_REVIEW')).toBe(false);
    expect(isCustomerEditable('CANCELLED')).toBe(false);
  });

  it('tells the guest whether they can still change the order', () => {
    expect(toCustomerVisibleState('AWAITING_CUSTOMER')).toBe('EDITABLE');
    expect(toCustomerVisibleState('CONFIRMED')).toBe('CONFIRMED');
  });

  it('only allows waiter edits before confirmation', () => {
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
