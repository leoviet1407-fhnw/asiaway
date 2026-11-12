/**
 * Prepares an EMPTY production database: creates the three locations and
 * nothing else (no sample users, no sample items).
 *
 *   DATABASE_URL=postgres://… npm run db:bootstrap
 *
 * Safe to repeat. Edit the addresses in the app's database later if needed;
 * the ones below are placeholders to be replaced with the real delivery addresses.
 */
import { locations } from '../src/server/db/schema';
import { LOCATIONS } from '../src/server/seed/sample-data';
import { openCliDatabase } from './cli-db';

const { db, close } = await openCliDatabase();
try {
  await db.insert(locations).values([...LOCATIONS]).onConflictDoNothing();
  console.log('Locations ready: ' + LOCATIONS.map((l) => l.name).join(', '));
  console.log('NOTE: the addresses are placeholders – replace them with the real delivery addresses.');
} finally {
  await close();
}
