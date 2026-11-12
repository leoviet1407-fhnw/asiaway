/**
 * Fills an EMPTY database with the sample data (locations, 3 suppliers, ~30
 * items, 5 users, 4 orders). `npm run dev` does this by itself for the local
 * PGlite database; this script is for a fresh Postgres or after deleting .pglite.
 *
 * Refuses a DATABASE_URL database unless SEED_ALLOW_PROD=1.
 */
import { openCliDatabase } from './cli-db';
import { SAMPLE_USERS, isEmpty, seedSampleData } from '../src/server/seed/sample-data';

if (process.env.DATABASE_URL && process.env.SEED_ALLOW_PROD !== '1') {
  console.error('DATABASE_URL is set. Sample data is for development; set SEED_ALLOW_PROD=1 if you really mean it.');
  process.exit(1);
}

const { db, close } = await openCliDatabase();
try {
  if (!(await isEmpty(db))) {
    console.log('The database already has users – nothing seeded. Delete .pglite/ to start over.');
  } else {
    await seedSampleData(db);
    console.log('Sample data loaded. Logins (password from SEED_PASSWORD, default "asiaway-dev"):');
    for (const u of SAMPLE_USERS) console.log(`  ${u.email.padEnd(26)} ${u.name}`);
  }
} finally {
  await close();
}
