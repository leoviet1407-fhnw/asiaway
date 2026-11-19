import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/domain/roles';
import type { OnboardingInput } from '@/domain/onboarding';
import type { AppDatabase } from '@/server/db/client';
import { auditEvents, staffProfiles, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { getMyOnboarding, listOnboarding, needsOnboarding, saveMyOnboarding } from '@/server/services/onboarding-service';
import { saveProfile } from '@/server/services/roster-service';
import { createTestDatabase } from '../helpers/db';

const input: OnboardingInput = {
  privateEmail: 'Staff@Gmail.com',
  mobile: '079 123 45 67',
  birthDate: '1995-04-12',
  street: 'Birchstrasse 12',
  zip: '8050',
  city: 'Zürich',
  nationality: 'Vietnam',
  iban: 'ch93 0076 2011 6238 5295 7',
  ahvNumber: '',
  emergencyName: '',
  emergencyPhone: '',
};

describe('onboarding (personal details)', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let admin: Principal;
  let planner: Principal;
  let staff: Principal;
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    planner = await principal('besteller@asiaway.test');
    staff = await principal('winti-vn@asiaway.test');
    await saveProfile(db, planner, staff.userId, { site: 'winterthur', employmentType: 'FULL_TIME', pensumPercent: 100, active: true });
    admin = { ...planner, grants: [{ role: 'ADMIN', locationId: null }] };
  }, 60_000);
  afterAll(async () => close());

  it('asks people on the roster and staff logins without a roster profile, not the admin', async () => {
    expect(await needsOnboarding(db, staff.userId)).toBe(true);
    // a kitchen login: STAFF role, no roster profile (like Sakuna and Phen)
    const kitchen = await principal('oerlikon@asiaway.test');
    await db.delete(staffProfiles).where(eq(staffProfiles.userId, kitchen.userId));
    expect(await needsOnboarding(db, kitchen.userId)).toBe(true);
    const [adminUser] = await db.select().from(users).where(eq(users.email, 'admin@asiaway.test'));
    expect(await needsOnboarding(db, adminUser!.id)).toBe(false);
    expect((await listOnboarding(db, admin)).some((r) => r.userId === kitchen.userId)).toBe(true);
  });

  it('rejects a wrong form without saving anything', async () => {
    const errors = await saveMyOnboarding(db, staff, { ...input, iban: 'CH00 1234' }, '2026-11-13');
    expect(errors).toHaveProperty('iban');
    expect(await getMyOnboarding(db, staff)).toBeNull();
    expect(await needsOnboarding(db, staff.userId)).toBe(true);
  });

  it('saves normalised values, stops asking, and fills the WhatsApp number', async () => {
    expect(await saveMyOnboarding(db, staff, input, '2026-11-13')).toBeNull();
    const saved = await getMyOnboarding(db, staff);
    expect(saved).toMatchObject({ privateEmail: 'staff@gmail.com', iban: 'CH9300762011623852957', mobile: '079 123 45 67' });
    expect(await needsOnboarding(db, staff.userId)).toBe(false);
    const [profile] = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, staff.userId));
    expect(profile!.phone).toBe('079 123 45 67');
  });

  it('can be updated later, and the audit log never holds the values', async () => {
    expect(await saveMyOnboarding(db, staff, { ...input, city: 'Winterthur' }, '2026-11-13')).toBeNull();
    expect((await getMyOnboarding(db, staff))!.city).toBe('Winterthur');
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, 'onboarding.save'));
    expect(events.length).toBe(2);
    expect(JSON.stringify(events)).not.toContain('CH93');
  });

  it('shows everybody\'s details to admins only', async () => {
    await expect(listOnboarding(db, planner)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(listOnboarding(db, staff)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const rows = await listOnboarding(db, admin);
    expect(rows.find((r) => r.userId === staff.userId)?.details?.iban).toBe('CH9300762011623852957');
  });
});
