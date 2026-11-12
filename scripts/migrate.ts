/** Applies pending migrations: DATABASE_URL=postgres://… npm run db:migrate */
import { openCliDatabase } from './cli-db';

const { mode, close } = await openCliDatabase();
console.log(`Migrations applied (${mode}).`);
await close();
