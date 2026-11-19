import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isAdmin, type Principal } from '../../domain/roles';
import { cleanOnboarding, validateOnboarding, type OnboardingInput } from '../../domain/onboarding';
import { todayIso } from '../../lib/dates';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { staffOnboarding, staffProfiles, userRoles, users } from '../db/schema';

export interface OnboardingRecord extends OnboardingInput {
  completedAt: Date;
  updatedAt: Date;
}

const toRecord = (r: typeof staffOnboarding.$inferSelect): OnboardingRecord => ({
  privateEmail: r.privateEmail,
  mobile: r.mobile,
  birthDate: r.birthDate,
  street: r.street,
  zip: r.zip,
  city: r.city,
  nationality: r.nationality ?? '',
  iban: r.iban,
  ahvNumber: r.ahvNumber ?? '',
  emergencyName: r.emergencyName ?? '',
  emergencyPhone: r.emergencyPhone ?? '',
  completedAt: r.completedAt,
  updatedAt: r.updatedAt,
});

/** The person's own details, or null if they have not filled them in yet. */
export async function getMyOnboarding(db: AppDatabase, p: Principal): Promise<OnboardingRecord | null> {
  const [row] = await db.select().from(staffOnboarding).where(eq(staffOnboarding.userId, p.userId));
  return row ? toRecord(row) : null;
}

/**
 * Whether this person is employed and so gives their personal details: everyone on the roster
 * (an active staff profile) and every staff login without one (e.g. kitchen staff who only
 * order). The owner/admin or an orderer without a staff role is not asked.
 */
async function isEmployee(db: AppDatabase, userId: string): Promise<boolean> {
  const [profile] = await db.select({ active: staffProfiles.active }).from(staffProfiles).where(eq(staffProfiles.userId, userId));
  if (profile) return profile.active;
  const [user] = await db.select({ active: users.active }).from(users).where(eq(users.id, userId));
  if (!user?.active) return false;
  const [staffRole] = await db.select({ role: userRoles.role }).from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, 'STAFF'))).limit(1);
  return Boolean(staffRole);
}

/** Whether this person still has to fill in their details (shown as an open task on the home page). */
export async function needsOnboarding(db: AppDatabase, userId: string): Promise<boolean> {
  if (!(await isEmployee(db, userId))) return false;
  const [done] = await db.select({ userId: staffOnboarding.userId }).from(staffOnboarding).where(eq(staffOnboarding.userId, userId));
  return !done;
}

/** Saves the person's own details (first time or an update). Returns the field errors, or null when saved. */
export async function saveMyOnboarding(
  db: AppDatabase,
  p: Principal,
  input: OnboardingInput,
  today = todayIso(),
): Promise<ReturnType<typeof validateOnboarding> | null> {
  const errors = validateOnboarding(input, today);
  if (Object.keys(errors).length > 0) return errors;
  const v = cleanOnboarding(input);
  const values = {
    privateEmail: v.privateEmail,
    mobile: v.mobile,
    birthDate: v.birthDate,
    street: v.street,
    zip: v.zip,
    city: v.city,
    nationality: v.nationality || null,
    iban: v.iban,
    ahvNumber: v.ahvNumber || null,
    emergencyName: v.emergencyName || null,
    emergencyPhone: v.emergencyPhone || null,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(staffOnboarding).values({ userId: p.userId, ...values }).onConflictDoUpdate({ target: staffOnboarding.userId, set: values });
    // The Leitung's WhatsApp link needs a number: use this one unless one is already set.
    await tx.update(staffProfiles).set({ phone: v.mobile }).where(and(eq(staffProfiles.userId, p.userId), or(isNull(staffProfiles.phone), eq(staffProfiles.phone, ''))));
  });
  // The log records that it happened, never the values.
  await audit(db, p.userId, 'onboarding.save', 'user', p.userId, {});
  return null;
}

export interface OnboardingOverviewRow {
  userId: string;
  name: string;
  email: string;
  details: OnboardingRecord | null;
}

/** Admin only: every active person on the roster with their details (or none yet). */
export async function listOnboarding(db: AppDatabase, p: Principal): Promise<OnboardingOverviewRow[]> {
  if (!isAdmin(p)) throw domainError('FORBIDDEN', 'Nur Admins sehen die persönlichen Angaben.');
  // Everyone on the roster, plus staff logins without a roster profile (e.g. kitchen staff)
  const profiles = await db.select({ userId: staffProfiles.userId, active: staffProfiles.active }).from(staffProfiles);
  const staffLogins = await db.selectDistinct({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.role, 'STAFF'));
  const ids = [...new Set([...profiles.filter((x) => x.active).map((x) => x.userId), ...staffLogins.map((x) => x.userId).filter((id) => !profiles.some((x) => x.userId === id))])];
  const rows = ids.length
    ? await db
        .select({ user: users, onboarding: staffOnboarding })
        .from(users)
        .leftJoin(staffOnboarding, eq(staffOnboarding.userId, users.id))
        .where(and(inArray(users.id, ids), eq(users.active, true)))
        .orderBy(asc(users.name))
    : [];
  await audit(db, p.userId, 'onboarding.list', 'user', p.userId, { count: rows.length });
  return rows.map((r) => ({ userId: r.user.id, name: r.user.name, email: r.user.email, details: r.onboarding ? toRecord(r.onboarding) : null }));
}
