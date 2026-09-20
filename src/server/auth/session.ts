import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { auditEvents, authSessions, loginAttempts, users } from '../db/schema';
import { verifyPassword } from './password';

export const WAITER_COOKIE = 'aw_wsid';
export const CUSTOMER_COOKIE = 'aw_dsid';

/** One shift, plus slack. Re-login is cheap; a stale tablet session is not. */
export const WAITER_SESSION_HOURS = 12;

/** Brute-force ceiling per account and per IP, within the window below. */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'WAITER';
}

export class AuthError extends Error {
  constructor(
    readonly code: 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'ACCOUNT_DISABLED',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

async function recentFailures(
  db: AppDatabase,
  emailLower: string,
  ipHash: string | null,
): Promise<number> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      sql`${loginAttempts.succeeded} = false
          and ${loginAttempts.attemptedAt} > ${since}
          and (${loginAttempts.emailLower} = ${emailLower}
               or (${ipHash}::text is not null and ${loginAttempts.ipHash} = ${ipHash}))`,
    );
  return rows[0]?.n ?? 0;
}

/**
 * Verifies credentials and opens a session.
 *
 * A wrong email and a wrong password produce the SAME error, so the login form
 * cannot be used to discover which staff accounts exist.
 */
export async function signIn(
  db: AppDatabase,
  input: {
    email: string;
    password: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{ user: AuthenticatedUser; token: string; expiresAt: Date }> {
  const emailLower = input.email.trim().toLowerCase();
  const ipHash = input.ipHash ?? null;

  if ((await recentFailures(db, emailLower, ipHash)) >= LOGIN_MAX_ATTEMPTS) {
    throw new AuthError('RATE_LIMITED', 'Too many attempts. Please wait and try again.');
  }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${emailLower}`);

  const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;

  if (!user || !ok) {
    await db.insert(loginAttempts).values({ emailLower, ipHash, succeeded: false });
    if (user) {
      await db.insert(auditEvents).values({
        actorType: 'SYSTEM',
        action: 'USER_LOGIN_FAILED',
        entityType: 'USER',
        entityId: user.id,
        metadata: { reason: 'bad_password' },
      });
    }
    throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  if (!user.isActive) {
    await db.insert(loginAttempts).values({ emailLower, ipHash, succeeded: false });
    throw new AuthError('ACCOUNT_DISABLED', 'This account is disabled');
  }

  const token = newOpaqueToken();
  const expiresAt = new Date(Date.now() + WAITER_SESSION_HOURS * 3600_000);

  await db.insert(authSessions).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt,
    userAgentHash: input.userAgentHash ?? null,
  });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await db.insert(loginAttempts).values({ emailLower, ipHash, succeeded: true });
  await db.insert(auditEvents).values({
    actorType: 'WAITER',
    actorUserId: user.id,
    action: 'USER_LOGIN_SUCCEEDED',
    entityType: 'USER',
    entityId: user.id,
    metadata: {},
  });

  return {
    user: { id: user.id, displayName: user.displayName, email: user.email, role: 'WAITER' },
    token,
    expiresAt,
  };
}

/** Resolves a cookie value to a live user, or null. Never throws on bad input. */
export async function resolveSession(
  db: AppDatabase,
  token: string | undefined | null,
): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  const rows = await db
    .select({
      sessionId: authSessions.id,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      isActive: users.isActive,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.tokenHash, sha256(token)),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    );

  const row = rows[0];
  if (!row || !row.isActive) return null;

  await db
    .update(authSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(authSessions.id, row.sessionId));

  return { id: row.userId, displayName: row.displayName, email: row.email, role: 'WAITER' };
}

export async function signOut(db: AppDatabase, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(authSessions.tokenHash, sha256(token)));
}

/** Constant-time compare, for CSRF tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
