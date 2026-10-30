/**
 * Which Asiaway restaurant this deployment serves.
 *
 * Each restaurant is its own deployment — its own database, its own address,
 * its own QR codes — built from the same code, so a fix reaches both. What
 * differs between them lives here and in the floor plan, and nowhere else.
 *
 * It is read from NEXT_PUBLIC_RESTAURANT_LOCATION at BUILD time, because the
 * waiter's browser needs it as much as the server does. Changing it means a
 * rebuild, not just a restart.
 */
export const RESTAURANT_LOCATIONS = ['oerlikon', 'winterthur'] as const;
export type RestaurantLocation = (typeof RESTAURANT_LOCATIONS)[number];

export interface RestaurantProfile {
  /**
   * The Saturday category: the weekly special with its photo, and Bánh Mì.
   * Winterthur does not serve the Saturday special.
   */
  readonly saturdayMenu: boolean;
  /**
   * Whether an order a waiter takes on their phone goes to the queue, with the
   * alert, for whoever enters orders into the POS. In Winterthur one person at
   * the iPad enters every order; in Oerlikon the waiter who took it does.
   */
  readonly queueWaiterOrders: boolean;
  /**
   * Where guests pay. "table": they ask for the bill and staff bring it over.
   * "counter": they pay, and get the bill, at Winterthur's counter in front of
   * the stairs, so there is no bill to ask for.
   */
  readonly payment: 'table' | 'counter';
  /** Whether guests can call a member of staff to their table from their phone. */
  readonly guestCallsStaff: boolean;
}

export const RESTAURANT_PROFILES: Readonly<Record<RestaurantLocation, RestaurantProfile>> = {
  oerlikon: { saturdayMenu: true, queueWaiterOrders: false, payment: 'table', guestCallsStaff: false },
  winterthur: { saturdayMenu: false, queueWaiterOrders: true, payment: 'counter', guestCallsStaff: true },
};

/**
 * Unset means Oerlikon, so the deployment that existed before Winterthur keeps
 * working with no change. A misspelt value fails loudly rather than quietly
 * showing waiters the wrong room.
 */
export function resolveLocation(value: string | undefined): RestaurantLocation {
  const key = (value ?? '').trim().toLowerCase();
  if (key === '') return 'oerlikon';

  const location = RESTAURANT_LOCATIONS.find((l) => l === key);
  if (!location) {
    throw new Error(
      `NEXT_PUBLIC_RESTAURANT_LOCATION must be one of ${RESTAURANT_LOCATIONS.join(', ')}, not "${value}"`,
    );
  }
  return location;
}

// Spelt out in full: Next.js only inlines NEXT_PUBLIC_ variables into the
// browser bundle when they are referenced literally.
export const RESTAURANT_LOCATION = resolveLocation(process.env.NEXT_PUBLIC_RESTAURANT_LOCATION);
export const RESTAURANT = RESTAURANT_PROFILES[RESTAURANT_LOCATION];
