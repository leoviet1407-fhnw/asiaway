import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestContext } from '../helpers/db';
import { auditEvents, authSessions, users } from '../../src/server/db/schema';
import { hashPassword, verifyPassword } from '../../src/server/auth/password';
import {
  AuthError,
  LOGIN_MAX_ATTEMPTS,
  resolveSession,
  signIn,
  signOut,
} from '../../src/server/auth/session';
import {
  decodeCustomerCookie,
  encodeCustomerCookie,
} from '../../src/server/auth/customer-cookie';
import type { AppDatabase } from '../../src/server/db/client';

let ctx: TestContext;
let db: AppDatabase;

const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  ctx = await createTestDatabase();
  db = ctx.db as unknown as AppDatabase;
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await ctx.client.exec(
    'truncate audit_events, auth_sessions, login_attempts, users restart identity cascade;',
  );
  await db.insert(users).values({
    email: 'Anna@Asiaway.test',
    displayName: 'Anna',
    passwordHash: await hashPassword(PASSWORD),
  });
});

describe('password hashing', () => {
  it('uses Argon2id and never stores the password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(PASSWORD);
  });

  it('salts: the same password hashes differently every time', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('verifies correctly and rejects a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('returns false rather than throwing on a corrupt hash', async () => {
    expect(await verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
  });

  it('refuses a password that is too short to be worth hashing', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
  });
});

describe('waiter sign-in', () => {
  it('accepts the right credentials, case-insensitively on the email', async () => {
    const result = await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });
    expect(result.user.displayName).toBe('Anna');
    expect(result.token).toBeTruthy();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('stores only a hash of the session token', async () => {
    const { token } = await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });
    const rows = await db.select().from(authSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toHaveLength(64);
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    const wrongUser = await signIn(db, { email: 'nobody@asiaway.test', password: PASSWORD }).catch(
      (e: AuthError) => e,
    );
    const wrongPass = await signIn(db, { email: 'anna@asiaway.test', password: 'nope' }).catch(
      (e: AuthError) => e,
    );

    expect((wrongUser as AuthError).code).toBe('INVALID_CREDENTIALS');
    expect((wrongPass as AuthError).code).toBe('INVALID_CREDENTIALS');
    expect((wrongUser as AuthError).message).toBe((wrongPass as AuthError).message);
  });

  it('refuses a disabled account', async () => {
    await db.update(users).set({ isActive: false });
    await expect(signIn(db, { email: 'anna@asiaway.test', password: PASSWORD })).rejects.toMatchObject({
      code: 'ACCOUNT_DISABLED',
    });
  });

  it('locks out after repeated failures, then still refuses the RIGHT password', async () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      await signIn(db, { email: 'anna@asiaway.test', password: 'wrong' }).catch(() => undefined);
    }
    await expect(signIn(db, { email: 'anna@asiaway.test', password: PASSWORD })).rejects.toMatchObject(
      { code: 'RATE_LIMITED' },
    );
  });

  it('audits both success and failure', async () => {
    await signIn(db, { email: 'anna@asiaway.test', password: 'wrong' }).catch(() => undefined);
    await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });

    const actions = (await db.select().from(auditEvents)).map((e) => e.action);
    expect(actions).toContain('USER_LOGIN_FAILED');
    expect(actions).toContain('USER_LOGIN_SUCCEEDED');
  });

  it('records the last login time', async () => {
    await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });
    const [user] = await db.select().from(users);
    expect(user!.lastLoginAt).not.toBeNull();
  });
});

describe('waiter session resolution', () => {
  it('resolves a valid token to the user', async () => {
    const { token } = await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });
    const user = await resolveSession(db, token);
    expect(user?.displayName).toBe('Anna');
  });

  it('returns null for missing, empty or unknown tokens', async () => {
    expect(await resolveSession(db, null)).toBeNull();
    expect(await resolveSession(db, '')).toBeNull();
    expect(await resolveSession(db, 'made-up-token')).toBeNull();
  });

  it('returns null once the session expired', async () => {
    const { token } = await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });
    await db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveSession(db, token)).toBeNull();
  });

  it('returns null after sign-out', async () => {
    const { token } = await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });
    await signOut(db, token);
    expect(await resolveSession(db, token)).toBeNull();
  });

  it('returns null once the account is deactivated mid-session', async () => {
    const { token } = await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });
    await db.update(users).set({ isActive: false });
    expect(await resolveSession(db, token)).toBeNull();
  });

  it('does not let one waiter session resolve to another user', async () => {
    const [other] = await db
      .insert(users)
      .values({
        email: 'bob@asiaway.test',
        displayName: 'Bob',
        passwordHash: await hashPassword(PASSWORD),
      })
      .returning();

    const anna = await signIn(db, { email: 'anna@asiaway.test', password: PASSWORD });
    const resolved = await resolveSession(db, anna.token);
    expect(resolved!.id).not.toBe(other!.id);
  });
});

describe('guest session cookie', () => {
  const payload = {
    sessionId: '11111111-1111-1111-1111-111111111111',
    tableId: '22222222-2222-2222-2222-222222222222',
    deviceId: '33333333-3333-3333-3333-333333333333',
    iat: 1_700_000_000,
  };

  it('round-trips a signed payload', () => {
    expect(decodeCustomerCookie(encodeCustomerCookie(payload))).toEqual(payload);
  });

  it('rejects a tampered payload — this is what stops cross-table access', () => {
    const cookie = encodeCustomerCookie(payload);
    const [version, body, signature] = cookie.split('.');

    const forged = Buffer.from(
      JSON.stringify({ ...payload, sessionId: '99999999-9999-9999-9999-999999999999' }),
    ).toString('base64url');

    // Same signature, different body: must not validate.
    expect(decodeCustomerCookie(`${version}.${forged}.${signature}`)).toBeNull();
  });

  it('rejects an unsigned or malformed cookie', () => {
    for (const bad of [
      '',
      'garbage',
      'v1.body',
      'v1.body.sig.extra',
      `v2.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`,
    ]) {
      expect(decodeCustomerCookie(bad), bad).toBeNull();
    }
    expect(decodeCustomerCookie(null)).toBeNull();
    expect(decodeCustomerCookie(undefined)).toBeNull();
  });

  it('rejects a well-signed cookie whose payload is the wrong shape', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
    // Signed by the real signer but structurally invalid.
    const cookie = encodeCustomerCookie(payload);
    const signature = cookie.split('.')[2];
    expect(decodeCustomerCookie(`v1.${body}.${signature}`)).toBeNull();
  });

  it('carries no personal data', () => {
    const decoded = decodeCustomerCookie(encodeCustomerCookie(payload))!;
    const json = JSON.stringify(decoded).toLowerCase();
    for (const forbidden of ['name', 'email', 'phone', 'card']) {
      expect(json).not.toContain(forbidden);
    }
  });
});
