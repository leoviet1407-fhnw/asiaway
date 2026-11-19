import { describe, expect, it } from 'vitest';
import { normalizeTime } from '../../src/components/TimeField';

describe('normalizeTime', () => {
  it('accepts the ways people type a time', () => {
    expect(normalizeTime('1030')).toBe('10:30');
    expect(normalizeTime('10.30')).toBe('10:30');
    expect(normalizeTime('9:00')).toBe('09:00');
    expect(normalizeTime('17:45')).toBe('17:45');
  });
  it('leaves anything that is not a time as typed', () => {
    expect(normalizeTime('')).toBe('');
    expect(normalizeTime('25:00')).toBe('25:00');
    expect(normalizeTime('abc')).toBe('abc');
  });
});
