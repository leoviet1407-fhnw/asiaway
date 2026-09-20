import { and, eq, isNull } from 'drizzle-orm';
import { restaurantTables, tableGroupMembers, tableGroups } from '../db/schema';
import type { Db } from './order-service';

export interface ActiveGroup {
  groupId: string;
  anchorTableId: string;
  memberTableNumbers: string[];
}

/**
 * The active group a table belongs to, if any.
 *
 * Every way of starting an order has to ask this. A QR scan already did, which
 * is why scanning any member's code produced one shared bill — but a waiter
 * taking the order on the tablet went straight to the table they tapped, so a
 * joined party could end up with two bills depending on which route the order
 * came in by. The lookup lives here, outside either service, so both use the
 * same answer.
 */
export async function activeGroupForTable(db: Db, tableId: string): Promise<ActiveGroup | null> {
  const [membership] = await db
    .select({ groupId: tableGroupMembers.tableGroupId, anchorTableId: tableGroups.anchorTableId })
    .from(tableGroupMembers)
    .innerJoin(tableGroups, eq(tableGroups.id, tableGroupMembers.tableGroupId))
    .where(
      and(
        eq(tableGroupMembers.tableId, tableId),
        isNull(tableGroupMembers.leftAt),
        eq(tableGroups.status, 'ACTIVE'),
      ),
    );

  if (!membership?.anchorTableId) return null;

  const members = await db
    .select({ tableNumber: restaurantTables.tableNumber })
    .from(tableGroupMembers)
    .innerJoin(restaurantTables, eq(restaurantTables.id, tableGroupMembers.tableId))
    .where(
      and(
        eq(tableGroupMembers.tableGroupId, membership.groupId),
        isNull(tableGroupMembers.leftAt),
      ),
    );

  return {
    groupId: membership.groupId,
    anchorTableId: membership.anchorTableId,
    memberTableNumbers: members
      .map((m) => m.tableNumber)
      .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
  };
}
