export type Role = 'STAFF' | 'ORDERER' | 'ADMIN';

export interface RoleGrant {
  readonly role: Role;
  /** null = all locations */
  readonly locationId: string | null;
}

export interface Principal {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly grants: readonly RoleGrant[];
}

export function isAdmin(p: Principal): boolean {
  return p.grants.some((g) => g.role === 'ADMIN');
}

/** Orderers (and admins) review and send orders for every location. */
export function isOrderer(p: Principal): boolean {
  return p.grants.some((g) => g.role === 'ORDERER' || g.role === 'ADMIN');
}

/**
 * Winterthur orders for the whole building: the location "winterthur" covers
 * both restaurants, so staff of either one can order and receive for it.
 */
export const COMBINED_LOCATIONS: Readonly<Record<string, readonly string[]>> = {
  winterthur: ['winti-vn', 'winti-th'],
};

/** The locations that are real restaurants (stock, daily closing), not combined order locations. */
export function isRestaurant(locationId: string): boolean {
  return !(locationId in COMBINED_LOCATIONS);
}

/** Whether the user works at this location at all (prepare drafts, receive goods). */
export function canAccessLocation(p: Principal, locationId: string): boolean {
  const covered = COMBINED_LOCATIONS[locationId] ?? [];
  return p.grants.some((g) => g.locationId === null || g.locationId === locationId || (g.locationId !== null && covered.includes(g.locationId)));
}

/** The locations this user can act for, out of all locations, in the given order. */
export function locationsFor<T extends { id: string }>(p: Principal, all: readonly T[]): T[] {
  return all.filter((l) => canAccessLocation(p, l.id));
}

export function roleLabel(role: Role): string {
  return { STAFF: 'Mitarbeiter', ORDERER: 'Besteller', ADMIN: 'Admin' }[role];
}
