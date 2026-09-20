import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The guest's dining-session cookie.
 *
 * The printed QR token only ever buys one thing: the right to start or join the
 * session at that table. The server then issues THIS signed cookie, and every
 * later request authorises against it. That is what stops someone reading or
 * changing another table's orders by swapping an identifier in a request body —
 * the cookie decides, not the payload.
 *
 * No personal data is inside: a session id, a table id and an anonymous device
 * id, nothing else.
 */
export interface CustomerCookiePayload {
  readonly sessionId: string;
  readonly tableId: string;
  readonly deviceId: string;
  /** Issued-at, epoch seconds. */
  readonly iat: number;
}

const VERSION = 'v1';

function secret(): string {
  const value = process.env.CUSTOMER_COOKIE_SECRET;
  if (!value || value.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CUSTOMER_COOKIE_SECRET must be set to at least 32 characters');
    }
    // Development only, and only when nothing was configured.
    return 'dev-only-insecure-secret-do-not-use-in-production';
  }
  return value;
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function encodeCustomerCookie(payload: CustomerCookiePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${VERSION}.${body}.${sign(`${VERSION}.${body}`)}`;
}

/** Returns null for anything tampered with, malformed or unsigned. */
export function decodeCustomerCookie(value: string | undefined | null): CustomerCookiePayload | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;

  const [version, body, signature] = parts as [string, string, string];
  if (version !== VERSION) return null;

  const expected = sign(`${version}.${body}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (
      typeof parsed?.sessionId === 'string' &&
      typeof parsed?.tableId === 'string' &&
      typeof parsed?.deviceId === 'string' &&
      typeof parsed?.iat === 'number'
    ) {
      return parsed as CustomerCookiePayload;
    }
    return null;
  } catch {
    return null;
  }
}
