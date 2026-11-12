/**
 * Photos from asiaway.ch, loaded straight from the website (nothing is copied
 * into this repository). Medium-size versions only, so phones stay fast.
 */
const BASE = 'https://asiaway.ch/wp-content/uploads';

export const SITE_IMAGES = {
  /** Noodle dishes and spring rolls on a dark table – the login background. */
  dishes: `${BASE}/2024/09/AdobeStock_335510693-1024x626.jpeg`,
} as const;

/** The reservations page that stays on the WordPress site for now. */
export const RESERVATIONS_URL = 'https://asiaway.ch/staff/reservationen/';
