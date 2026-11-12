import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDatabase } from '@/server/db/client';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { MAX_FAILED_LOGINS, login, logout, principalFromToken } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { createTestDatabase } from '../helpers/db';

let db: AppDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedSampleData(db, { password: 'test-password', withOrders: false });
});
afterAll(async () => close());

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
    await expect(hashPassword('short')).rejects.toThrow();
  });
});

describe('sessions', () => {
  it('logs in with roles and logs out', async () => {
    const { token } = await login(db, 'Oerlikon@AsiaWay.test', 'test-password');
    const p = await principalFromToken(db, token);
    expect(p?.grants).toEqual([{ role: 'STAFF', locationId: 'oerlikon' }]);
    await logout(db, token);
    expect(await principalFromToken(db, token)).toBeNull();
  });

  it('expires sessions', async () => {
    const { token } = await login(db, 'admin@asiaway.test', 'test-password');
    expect(await principalFromToken(db, token, new Date(Date.now() + 31 * 24 * 3600 * 1000))).toBeNull();
  });

  it('refuses wrong passwords and pauses after too many', async () => {
    await expect(login(db, 'nobody@asiaway.test', 'x')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await expect(login(db, 'winti-vn@asiaway.test', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    await expect(login(db, 'winti-vn@asiaway.test', 'test-password')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
