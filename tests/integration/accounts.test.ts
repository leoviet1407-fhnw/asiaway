import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { staffProfiles, users } from '@/server/db/schema';
import { loadPrincipalForUser, login, principalFromToken } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { createAccount, listAccounts, resetAccountPassword, setAccountActive, updateAccount } from '@/server/services/account-service';
import { createSupplier, listSuppliers } from '@/server/services/catalog-service';
import { createTestDatabase } from '../helpers/db';

let db: AppDatabase;
let close: () => Promise<void>;
let admin: Principal;
let orderer: Principal;

async function principal(email: string): Promise<Principal> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await loadPrincipalForUser(db, u!.id))!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedSampleData(db, { password: 'test-password', withOrders: false });
  const all = await db.select().from(users);
  const adminUser = all.find((u) => /admin/i.test(u.email))!;
  admin = (await loadPrincipalForUser(db, adminUser.id))!;
  orderer = await principal('besteller@asiaway.test');
}, 60_000);

afterAll(async () => close());

describe('accounts', () => {
  it('an admin creates a login that can sign in; others cannot create accounts', async () => {
    const { id, password } = await createAccount(db, admin, { name: 'Mai', email: 'mai@asiaway.test', locationIds: ['oerlikon'], orderer: false, planner: false, admin: false, roster: null });
    expect(password.length).toBeGreaterThanOrEqual(10);
    const { token } = await login(db, 'mai@asiaway.test', password);
    const me = await principalFromToken(db, token);
    expect(me?.userId).toBe(id);
    expect(me?.grants).toEqual([{ role: 'STAFF', locationId: 'oerlikon' }]);
    await expect(createAccount(db, orderer, { name: 'X', email: 'x@asiaway.test', locationIds: ['oerlikon'], orderer: false, planner: false, admin: false, roster: null })).rejects.toThrow();
    await expect(createAccount(db, admin, { name: 'Mai 2', email: 'MAI@asiaway.test', locationIds: ['oerlikon'], orderer: false, planner: false, admin: false, roster: null })).rejects.toThrow(/schon verwendet/);
  });

  it('with a roster site the person is on the roster and works in its restaurants', async () => {
    const { id } = await createAccount(db, admin, { name: 'Lan', email: 'lan@asiaway.test', locationIds: [], orderer: false, planner: false, admin: false, roster: { site: 'winterthur', employmentType: 'PART_TIME', pensumPercent: 60 } });
    const [profile] = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, id));
    expect(profile).toMatchObject({ site: 'winterthur', pensumPercent: 60, active: true });
    const acc = (await listAccounts(db, admin)).find((a) => a.id === id)!;
    expect(acc.locationIds.sort()).toEqual(['winti-th', 'winti-vn']);
  });

  it('changes rights, resets the password and switches the account off and on', async () => {
    const { id, password } = await createAccount(db, admin, { name: 'Tam', email: 'tam@asiaway.test', locationIds: ['oerlikon'], orderer: false, planner: false, admin: false, roster: { site: 'oerlikon', employmentType: 'ON_CALL', pensumPercent: null } });
    await updateAccount(db, admin, id, { name: 'Tam N.', email: 'tam@asiaway.test', locationIds: ['oerlikon'], orderer: true, planner: false, admin: false });
    expect((await loadPrincipalForUser(db, id))!.grants.some((g) => g.role === 'ORDERER')).toBe(true);

    const { token } = await login(db, 'tam@asiaway.test', password);
    const fresh = await resetAccountPassword(db, admin, id);
    expect(await principalFromToken(db, token)).toBeNull(); // signed out everywhere
    await expect(login(db, 'tam@asiaway.test', password)).rejects.toThrow();
    const again = await login(db, 'tam@asiaway.test', fresh);

    await setAccountActive(db, admin, id, false);
    expect(await principalFromToken(db, again.token)).toBeNull();
    await expect(login(db, 'tam@asiaway.test', fresh)).rejects.toThrow();
    const [profile] = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, id));
    expect(profile!.active).toBe(false);

    await setAccountActive(db, admin, id, true);
    await expect(login(db, 'tam@asiaway.test', fresh)).resolves.toBeTruthy();
  });

  it('an admin cannot switch off themselves or drop their own admin right', async () => {
    await expect(setAccountActive(db, admin, admin.userId, false)).rejects.toThrow(/eigene Konto/);
    await expect(updateAccount(db, admin, admin.userId, { name: admin.name, email: admin.email, locationIds: [], orderer: false, planner: false, admin: false })).rejects.toThrow(/Admin-Recht/);
  });
});

describe('suppliers', () => {
  it('an orderer adds a supplier; the same name twice is refused', async () => {
    const input = { name: 'Asia Markt AG', orderEmail: 'order@asiamarkt.test', ccEmail: null, phone: null, orderChannel: 'EMAIL' as const, deliveryDays: 'Di, Fr', cutoffNote: null, minOrderCents: 15000, customerNumber: '123', notes: null };
    const id = await createSupplier(db, orderer, input);
    expect((await listSuppliers(db)).find((s) => s.id === id)).toMatchObject({ name: 'Asia Markt AG', minOrderCents: 15000, active: true });
    await expect(createSupplier(db, orderer, { ...input, name: ' asia markt ag ' })).rejects.toThrow(/gibt es schon/);
    await expect(createSupplier(db, orderer, { ...input, name: 'Y', orderEmail: 'nope' })).rejects.toThrow(/ungültig/);
  });
});
