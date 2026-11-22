import { randomBytes } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isAdmin, isRestaurant, type Principal, type Role } from '../../domain/roles';
import { ROSTER_SITES } from '../../domain/roster';
import { hashPassword } from '../auth/password';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { locations, sessions, staffProfiles, userRoles, users } from '../db/schema';

/**
 * Logins of the team (admin only): create, change rights, new password, switch off.
 * Accounts are never deleted: orders, shifts and closings keep pointing at the person.
 * A switched-off account cannot sign in any more and is no longer planned.
 */

export interface Account {
  id: string;
  name: string;
  email: string;
  active: boolean;
  /** Restaurants the person works at (orders, goods-in, closing). */
  locationIds: string[];
  orderer: boolean;
  planner: boolean;
  admin: boolean;
  /** Roster site, when the person is on the roster. */
  rosterSite: string | null;
  rosterActive: boolean;
  createdAt: Date;
}

export interface AccountRights {
  locationIds: string[];
  /** Approves and sends orders, keeps products and suppliers. */
  orderer: boolean;
  /** Makes the roster, approves holidays and changes. */
  planner: boolean;
  admin: boolean;
}

export interface AccountCreate extends AccountRights {
  name: string;
  email: string;
  /** Also put the person on the roster of this site. */
  roster: { site: string; employmentType: 'FULL_TIME' | 'PART_TIME' | 'ON_CALL' | 'MANAGEMENT'; pensumPercent: number | null } | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const newPassword = () => randomBytes(9).toString('base64url');

function requireAdmin(p: Principal) {
  if (!isAdmin(p)) throw domainError('FORBIDDEN', 'Nur Admins verwalten Konten.');
}

export async function listAccounts(db: AppDatabase, p: Principal): Promise<Account[]> {
  requireAdmin(p);
  const rows = await db.select().from(users).orderBy(asc(users.name));
  const roles = await db.select().from(userRoles);
  const profiles = await db.select().from(staffProfiles);
  return rows.map((u) => {
    const mine = roles.filter((r) => r.userId === u.id);
    const profile = profiles.find((s) => s.userId === u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      active: u.active,
      locationIds: [...new Set(mine.filter((r) => r.role === 'STAFF' && r.locationId).map((r) => r.locationId!))],
      orderer: mine.some((r) => r.role === 'ORDERER'),
      planner: mine.some((r) => r.role === 'PLANNER'),
      admin: mine.some((r) => r.role === 'ADMIN'),
      rosterSite: profile?.site ?? null,
      rosterActive: Boolean(profile?.active),
      createdAt: u.createdAt,
    };
  });
}

async function checkRights(db: AppDatabase, rights: AccountRights) {
  const known = new Set((await db.select({ id: locations.id }).from(locations)).map((l) => l.id).filter(isRestaurant));
  for (const id of rights.locationIds) if (!known.has(id)) throw domainError('VALIDATION_FAILED', 'Unbekannter Standort.');
  if (rights.locationIds.length === 0 && !rights.orderer && !rights.planner && !rights.admin) {
    throw domainError('VALIDATION_FAILED', 'Bitte mindestens einen Standort oder ein Recht wählen.');
  }
}

const roleRows = (userId: string, r: AccountRights) => [
  ...[...new Set(r.locationIds)].map((locationId) => ({ userId, role: 'STAFF' as Role, locationId })),
  ...(r.orderer ? [{ userId, role: 'ORDERER' as Role, locationId: null }] : []),
  ...(r.planner ? [{ userId, role: 'PLANNER' as Role, locationId: null }] : []),
  ...(r.admin ? [{ userId, role: 'ADMIN' as Role, locationId: null }] : []),
];

async function emailTaken(db: AppDatabase, email: string, exceptId: string | null) {
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  return Boolean(u && u.id !== exceptId);
}

async function activeAdmins(db: AppDatabase): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(userRoles).innerJoin(users, eq(users.id, userRoles.userId)).where(sql`${userRoles.role} = 'ADMIN' and ${users.active}`);
  return [...new Set(rows.map((r) => r.id))];
}

/** Creates a login; returns the new id and the starting password (shown once). */
export async function createAccount(db: AppDatabase, p: Principal, input: AccountCreate): Promise<{ id: string; password: string }> {
  requireAdmin(p);
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name) throw domainError('VALIDATION_FAILED', 'Name fehlt.');
  if (!EMAIL_RE.test(email)) throw domainError('VALIDATION_FAILED', 'E-Mail ist ungültig.');
  if (await emailTaken(db, email, null)) throw domainError('VALIDATION_FAILED', 'Diese E-Mail wird schon verwendet.');
  if (input.roster && !ROSTER_SITES.some((s) => s.id === input.roster!.site)) throw domainError('VALIDATION_FAILED', 'Unbekannter Standort.');
  const rights = { ...input, locationIds: input.locationIds.length || !input.roster ? input.locationIds : [...ROSTER_SITES.find((s) => s.id === input.roster!.site)!.locationIds] };
  await checkRights(db, rights);
  const password = newPassword();
  const hash = await hashPassword(password);
  const id = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ name, email, passwordHash: hash }).returning({ id: users.id });
    await tx.insert(userRoles).values(roleRows(u!.id, rights));
    if (input.roster) {
      const withPensum = input.roster.employmentType === 'FULL_TIME' || input.roster.employmentType === 'PART_TIME';
      const pensum = withPensum ? input.roster.pensumPercent : null;
      if (withPensum && !(pensum && pensum > 0 && pensum <= 100)) throw domainError('VALIDATION_FAILED', 'Pensum muss zwischen 1 und 100 % liegen.');
      await tx.insert(staffProfiles).values({ userId: u!.id, site: input.roster.site, employmentType: input.roster.employmentType, pensumPercent: pensum, active: true });
    }
    return u!.id;
  });
  await audit(db, p.userId, 'account.create', 'user', id, { email, roster: input.roster?.site ?? null });
  return { id, password };
}

/** Name, e-mail and rights. An admin cannot take away their own admin right. */
export async function updateAccount(db: AppDatabase, p: Principal, id: string, input: AccountRights & { name: string; email: string }): Promise<void> {
  requireAdmin(p);
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name) throw domainError('VALIDATION_FAILED', 'Name fehlt.');
  if (!EMAIL_RE.test(email)) throw domainError('VALIDATION_FAILED', 'E-Mail ist ungültig.');
  if (await emailTaken(db, email, id)) throw domainError('VALIDATION_FAILED', 'Diese E-Mail wird schon verwendet.');
  if (id === p.userId && !input.admin) throw domainError('VALIDATION_FAILED', 'Das eigene Admin-Recht kann man nicht entfernen.');
  await checkRights(db, input);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ name, email }).where(eq(users.id, id));
    await tx.delete(userRoles).where(eq(userRoles.userId, id));
    await tx.insert(userRoles).values(roleRows(id, input));
  });
  await audit(db, p.userId, 'account.update', 'user', id, { orderer: input.orderer, planner: input.planner, admin: input.admin, locations: input.locationIds });
}

/** A new starting password; the person is signed out everywhere. */
export async function resetAccountPassword(db: AppDatabase, p: Principal, id: string): Promise<string> {
  requireAdmin(p);
  const password = newPassword();
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, id));
  await db.delete(sessions).where(eq(sessions.userId, id));
  await audit(db, p.userId, 'account.password_reset', 'user', id, {});
  return password;
}

/** Switch an account off (left the company) or on again. Off = signed out, no login, not planned. */
export async function setAccountActive(db: AppDatabase, p: Principal, id: string, active: boolean): Promise<void> {
  requireAdmin(p);
  if (!active) {
    if (id === p.userId) throw domainError('VALIDATION_FAILED', 'Das eigene Konto kann man nicht abschalten.');
    const admins = await activeAdmins(db);
    if (admins.length === 1 && admins[0] === id) throw domainError('VALIDATION_FAILED', 'Der letzte Admin kann nicht abgeschaltet werden.');
  }
  await db.update(users).set({ active }).where(eq(users.id, id));
  await db.update(staffProfiles).set({ active }).where(eq(staffProfiles.userId, id));
  if (!active) await db.delete(sessions).where(eq(sessions.userId, id));
  await audit(db, p.userId, active ? 'account.activate' : 'account.deactivate', 'user', id, {});
}
