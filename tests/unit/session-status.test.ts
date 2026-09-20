import { describe, expect, it } from 'vitest';
import { tableDisplayState, transitionSession } from '../../src/domain/session/status';
import { DomainError } from '../../src/domain/errors';

describe('session state machine', () => {
  it('moves to ORDER_PENDING when an order arrives', () => {
    expect(transitionSession('OCCUPIED', 'ORDER_SUBMITTED')).toBe('ORDER_PENDING');
  });

  it('returns to OCCUPIED once every order is resolved', () => {
    expect(transitionSession('ORDER_PENDING', 'ALL_ORDERS_RESOLVED')).toBe('OCCUPIED');
  });

  it('does NOT close the session on a checkout request', () => {
    const next = transitionSession('ORDER_PENDING', 'REQUEST_CHECKOUT');
    expect(next).toBe('CHECKOUT_REQUESTED');
    expect(next).not.toBe('CLOSED');
  });

  it('still accepts orders after the bill was requested', () => {
    expect(transitionSession('CHECKOUT_REQUESTED', 'ORDER_SUBMITTED')).toBe('ORDER_PENDING');
  });

  it('keeps CHECKOUT_REQUESTED when orders resolve, so the bill is not forgotten', () => {
    expect(transitionSession('CHECKOUT_REQUESTED', 'ALL_ORDERS_RESOLVED')).toBe('CHECKOUT_REQUESTED');
  });

  it('closes normally from CHECKOUT_REQUESTED', () => {
    expect(transitionSession('CHECKOUT_REQUESTED', 'CLOSE')).toBe('CLOSED');
  });

  it('refuses to close a session with orders still awaiting the waiter', () => {
    expect(() => transitionSession('ORDER_PENDING', 'CLOSE')).toThrow(DomainError);
  });

  it('allows a forced close but demands a reason for the audit trail', () => {
    expect(transitionSession('ORDER_PENDING', 'CLOSE', { force: true, reason: 'guest left' })).toBe('CLOSED');
    expect(() => transitionSession('ORDER_PENDING', 'CLOSE', { force: true })).toThrow(DomainError);
    expect(() => transitionSession('ORDER_PENDING', 'CLOSE', { force: true, reason: '  ' })).toThrow(DomainError);
  });

  it('makes CLOSED terminal', () => {
    for (const t of ['ORDER_SUBMITTED', 'REQUEST_CHECKOUT', 'CLOSE', 'ALL_ORDERS_RESOLVED'] as const) {
      expect(() => transitionSession('CLOSED', t), t).toThrow(DomainError);
    }
  });

  it('derives AVAILABLE from the absence of an open session', () => {
    expect(tableDisplayState(null)).toBe('AVAILABLE');
    expect(tableDisplayState('CLOSED')).toBe('AVAILABLE');
    expect(tableDisplayState('OCCUPIED')).toBe('OCCUPIED');
    expect(tableDisplayState('CHECKOUT_REQUESTED')).toBe('CHECKOUT_REQUESTED');
  });
});
