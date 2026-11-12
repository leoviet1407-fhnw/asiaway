import type { AppDatabase } from './db/client';
import { auditEvents } from './db/schema';

/** Append-only record of who changed what. */
export async function audit(
  db: AppDatabase,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEvents).values({ userId, action, entity, entityId, details });
}
