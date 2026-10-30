import { describe, expect, it } from 'vitest';
import { RESTAURANT_PROFILES, resolveLocation } from '../../src/config/restaurant';

describe('which restaurant a deployment serves', () => {
  it('is Oerlikon when nothing is set, so the existing deployment is unchanged', () => {
    expect(resolveLocation(undefined)).toBe('oerlikon');
    expect(resolveLocation('')).toBe('oerlikon');
    expect(resolveLocation('  ')).toBe('oerlikon');
  });

  it('accepts either restaurant, however it is capitalised', () => {
    expect(resolveLocation('winterthur')).toBe('winterthur');
    expect(resolveLocation(' Winterthur ')).toBe('winterthur');
    expect(resolveLocation('OERLIKON')).toBe('oerlikon');
  });

  it('refuses a misspelt restaurant rather than showing the wrong room', () => {
    expect(() => resolveLocation('winterhur')).toThrow(/winterhur/);
    expect(() => resolveLocation('zurich')).toThrow();
    expect(() => resolveLocation('constructor')).toThrow();
  });

  it('serves the Saturday menu in Oerlikon only', () => {
    expect(RESTAURANT_PROFILES.oerlikon.saturdayMenu).toBe(true);
    expect(RESTAURANT_PROFILES.winterthur.saturdayMenu).toBe(false);
  });

  it('takes payment at the counter and lets guests call staff in Winterthur only', () => {
    expect(RESTAURANT_PROFILES.winterthur).toMatchObject({ payment: 'counter', guestCallsStaff: true });
    expect(RESTAURANT_PROFILES.oerlikon).toMatchObject({ payment: 'table', guestCallsStaff: false });
  });

  it('sends waiter-taken orders to the POS queue in Winterthur only', () => {
    expect(RESTAURANT_PROFILES.winterthur.queueWaiterOrders).toBe(true);
    expect(RESTAURANT_PROFILES.oerlikon.queueWaiterOrders).toBe(false);
  });
});
