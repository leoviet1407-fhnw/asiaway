import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import type { Principal, Role } from '../../domain/roles';
import type { AppDatabase } from '../db/client';
import { loginAttempts, sessions, userRoles, users } from '../db/schema';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';

/**
 * Personal logins. A session is a random token in an httpOnly cookie; only its
 * SHA-256 is stored, so a leaked database cannot be replayed as a login.
 */
export const SESSION_COOKIE = 'aw_staff_session';
export const SESSION_DAYS = 30;
const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_LOGINS = 10;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Checks email + password; returns a new session token. */
export async function login(
  db: AppDatabase,
  email: string,
  password: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date; userId: string }> {
  const emailLower = email.trim().toLowerCase();
  const since = new Date(now.getTime() - WINDOW_MS);
  const [fails] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(eq(loginAttempts.emailLower, emailLower), eq(loginAttempts.succeeded, false), gt(loginAttempts.attemptedAt, since)),
    );
  if (Number(fails?.n ?? 0) >= MAX_FAILED_LOGINS) {
    throw domainError('RATE_LIMITED', 'Too many failed logins');
  }

  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${emailLower}`).limit(1);
  // Hash even for an unknown email, so timing does not reveal which emails exist.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  const ok = Boolean(user && user.active && passwordOk);
  await db.insert(loginAttempts).values({ emailLower, succeeded: ok, attemptedAt: now });
  if (!ok || !user) throw domainError('UNAUTHENTICATED', 'Wrong email or password');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId: user.id, expiresAt });
  return { token, expiresAt, userId: user.id };
}

export async function logout(db: AppDatabase, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function loadPrincipalForUser(db: AppDatabase, userId: string): Promise<Principal | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.active) return null;
  const grants = await db
    .select({ role: userRoles.role, locationId: userRoles.locationId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    grants: grants.map((g) => ({ role: g.role as Role, locationId: g.locationId })),
  };
}

/** The signed-in user for a session token, or null (missing, expired, deactivated). */
export async function principalFromToken(
  db: AppDatabase,
  token: string | undefined,
  now = new Date(),
): Promise<Principal | null> {
  if (!token) return null;
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!session) return null;
  return loadPrincipalForUser(db, session.userId);
}

/** Changes the signed-in user's own password. All their other sessions are ended. */
export async function changePassword(db: AppDatabase, userId: string, current: string, next: string, keepToken?: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw domainError('UNAUTHENTICATED', 'Das aktuelle Passwort ist falsch.');
  if (next.length < 8) throw domainError('VALIDATION_FAILED', 'Das neue Passwort braucht mindestens 8 Zeichen.');
  if (next === current) throw domainError('VALIDATION_FAILED', 'Das neue Passwort muss anders sein.');
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  const others = await db.select({ h: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, userId));
  const keep = keepToken ? hashToken(keepToken) : null;
  for (const o of others) if (o.h !== keep) await db.delete(sessions).where(eq(sessions.tokenHash, o.h));
}
