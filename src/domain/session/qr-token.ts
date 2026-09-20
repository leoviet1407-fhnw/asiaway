import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * QR tokens.
 *
 * 128 bits of CSPRNG output, base64url encoded, so a token is neither guessable
 * nor enumerable and is not derived from the table number.
 *
 * A printed QR is visible to everyone in the room, so it is deliberately NOT
 * treated as a bearer secret. Its only power is "start or join the session at
 * this table"; resolving it issues a signed httpOnly cookie, and every later
 * request authorises against that cookie instead.
 */
export const QR_TOKEN_BYTES = 16;
export const QR_TOKEN_LENGTH = 22; // base64url of 16 bytes, padding stripped

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function generateQrToken(): string {
  return randomBytes(QR_TOKEN_BYTES).toString('base64url');
}

export function isWellFormedQrToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** Constant-time comparison, so token checks cannot be timed. */
export function qrTokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function qrUrlFor(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/t/${token}`;
}
