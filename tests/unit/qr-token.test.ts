import { describe, expect, it } from 'vitest';
import {
  generateQrToken,
  isWellFormedQrToken,
  qrTokensMatch,
  qrUrlFor,
} from '../../src/domain/session/qr-token';

describe('QR tokens', () => {
  it('produces 22-character base64url tokens', () => {
    const token = generateQrToken();
    expect(token).toHaveLength(22);
    expect(isWellFormedQrToken(token)).toBe(true);
  });

  it('is not enumerable: 2000 tokens, no collisions', () => {
    const tokens = new Set(Array.from({ length: 2000 }, generateQrToken));
    expect(tokens.size).toBe(2000);
  });

  it('never encodes the table number', () => {
    expect(generateQrToken()).not.toMatch(/^table/i);
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', '12', 'short', 'a'.repeat(23), 'has spaces here 1234x', '../../etc/pw']) {
      expect(isWellFormedQrToken(bad), bad).toBe(false);
    }
  });

  it('compares tokens without leaking timing', () => {
    const a = generateQrToken();
    expect(qrTokensMatch(a, a)).toBe(true);
    expect(qrTokensMatch(a, generateQrToken())).toBe(false);
    expect(qrTokensMatch(a, 'short')).toBe(false);
  });

  it('builds a URL that carries nothing but the token', () => {
    expect(qrUrlFor('https://example.test/', 'abcdefghijklmnopqrstuv')).toBe(
      'https://example.test/t/abcdefghijklmnopqrstuv',
    );
  });
});
