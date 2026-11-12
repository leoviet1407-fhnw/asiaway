import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Principal } from '../../domain/roles';
import { isAdmin, isOrderer } from '../../domain/roles';
import { db } from '../db';
import { SESSION_COOKIE, principalFromToken } from './session';

/** The signed-in user for this request, or null. */
export async function currentPrincipal(): Promise<Principal | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return principalFromToken(await db(), token);
}

/** The signed-in user; sends anyone else to the login page. */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await currentPrincipal();
  if (!principal) redirect('/login');
  return principal;
}

export async function requireOrderer(): Promise<Principal> {
  const p = await requirePrincipal();
  if (!isOrderer(p)) redirect('/');
  return p;
}

export async function requireAdmin(): Promise<Principal> {
  const p = await requirePrincipal();
  if (!isAdmin(p)) redirect('/');
  return p;
}
