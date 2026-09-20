import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { DomainError } from '../../domain/errors';
import {
  AuthError,
  CUSTOMER_COOKIE,
  SERVICE_ROLES,
  WAITER_COOKIE,
  resolveSession,
} from '../auth/session';
import { decodeCustomerCookie, type CustomerCookiePayload } from '../auth/customer-cookie';
import { db } from '../db/index';
import type { AuthenticatedUser } from '../auth/session';

/** Stable error codes; localised text is chosen by the client from the code. */
const STATUS_BY_CODE: Record<string, number> = {
  QR_INVALID: 404,
  SESSION_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  SESSION_CLOSED: 409,
  SESSION_ALREADY_OPEN: 409,
  ITEMS_UNAVAILABLE: 409,
  REVISION_CONFLICT: 409,
  REQUEST_IN_FLIGHT: 409,
  SESSION_HAS_UNRESOLVED_ORDERS: 409,
  ORDER_NOT_EDITABLE: 409,
  ILLEGAL_ORDER_TRANSITION: 409,
  ILLEGAL_SESSION_TRANSITION: 409,
  ILLEGAL_TIME_ENTRY_TRANSITION: 409,
  INVALID_PERIOD: 409,
  EMPTY_CART: 400,
  CART_TOO_LARGE: 400,
  INVALID_QUANTITY: 400,
  NOTE_TOO_LONG: 400,
  REASON_REQUIRED: 400,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
};

export function apiError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  status?: number,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: status ?? STATUS_BY_CODE[code] ?? 400 },
  );
}

/**
 * Turns any thrown value into a safe response.
 *
 * Domain and auth errors keep their code so the UI can react precisely.
 * Anything else becomes a generic 500: stack traces, SQL fragments and internal
 * ids never reach a caller.
 */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return apiError(error.code, error.message, error.details);
  }
  if (error instanceof AuthError) {
    return apiError(error.code, error.message);
  }
  console.error('[api] unhandled error', error);
  return apiError('INTERNAL_ERROR', 'An unexpected error occurred', undefined, 500);
}

export function hashIp(value: string | null): string | null {
  return value ? createHash('sha256').update(value).digest('hex').slice(0, 32) : null;
}

export async function requestIpHash(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : h.get('x-real-ip');
  return hashIp(ip);
}

export async function userAgentHash(): Promise<string | null> {
  const h = await headers();
  return hashIp(h.get('user-agent'));
}

/** The guest's session, taken from the signed cookie and nothing else. */
export async function getCustomerContext(): Promise<CustomerCookiePayload | null> {
  const jar = await cookies();
  return decodeCustomerCookie(jar.get(CUSTOMER_COOKIE)?.value);
}

export async function requireCustomerContext(): Promise<CustomerCookiePayload> {
  const context = await getCustomerContext();
  if (!context) {
    throw new DomainError('SESSION_NOT_FOUND', 'Please scan the QR code at your table again');
  }
  return context;
}

/**
 * Any signed-in employee, whatever their role.
 *
 * The cookie is still called aw_wsid: it was minted before anyone but waiters
 * could sign in, and renaming it would sign the whole team out for no gain.
 */
export async function getStaffMember(): Promise<AuthenticatedUser | null> {
  const jar = await cookies();
  const token = jar.get(WAITER_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(await db(), token);
}

/** Only a MANAGER plans the roster, approves absences and closes the month. */
export async function getManager(): Promise<AuthenticatedUser | null> {
  const user = await getStaffMember();
  return user && user.role === 'MANAGER' ? user : null;
}

/** A signed-in employee who may work the floor. Kitchen STAFF may not. */
export async function getWaiter(): Promise<AuthenticatedUser | null> {
  const user = await getStaffMember();
  if (!user || !SERVICE_ROLES.includes(user.role)) return null;
  return user;
}

export async function requireWaiter(): Promise<AuthenticatedUser> {
  const user = await getWaiter();
  if (!user) {
    throw new DomainError('VALIDATION_FAILED', 'Authentication required');
  }
  return user;
}

/**
 * Every waiter mutation re-checks authentication in the handler itself.
 * Middleware is a convenience, never the boundary.
 */
export async function withWaiter<T>(
  fn: (user: AuthenticatedUser) => Promise<T>,
): Promise<T | NextResponse> {
  return withAuthenticated(getWaiter, fn);
}

/**
 * The same guarantees for a screen every employee uses, such as submitting
 * availability, where being rostered at all is the only qualification.
 */
export async function withStaffMember<T>(
  fn: (user: AuthenticatedUser) => Promise<T>,
): Promise<T | NextResponse> {
  return withAuthenticated(getStaffMember, fn);
}

export async function withManager<T>(
  fn: (user: AuthenticatedUser) => Promise<T>,
): Promise<T | NextResponse> {
  return withAuthenticated(getManager, fn);
}

async function withAuthenticated<T>(
  resolve: () => Promise<AuthenticatedUser | null>,
  fn: (user: AuthenticatedUser) => Promise<T>,
): Promise<T | NextResponse> {
  const user = await resolve();
  if (!user) return apiError('UNAUTHENTICATED', 'Please sign in');

  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('host');
  // Same-origin check on state-changing requests, on top of SameSite=Strict.
  if (origin && host && !origin.endsWith(host)) {
    return apiError('FORBIDDEN', 'Cross-origin request rejected');
  }

  return fn(user);
}

/**
 * Fixed-window rate limiting, in process.
 *
 * Enough for one restaurant on one container, which is the Phase 1 deployment.
 * A multi-instance deployment should move this to the database or a shared
 * store; `check` is the only place that changes.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;

  bucket.count += 1;
  return true;
}

export async function enforceRateLimit(
  scope: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const ip = (await requestIpHash()) ?? 'unknown';
  if (!rateLimit(`${scope}:${ip}`, limit, windowMs)) {
    return apiError('RATE_LIMITED', 'Too many requests. Please slow down.');
  }
  return null;
}

export const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;
