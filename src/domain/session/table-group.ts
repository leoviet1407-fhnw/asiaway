import { domainError } from '../errors';

/**
 * Combined tables.
 *
 * Restaurant decision (E4): when tables are joined, the session belongs to the
 * LOWEST-NUMBERED table in the group. Scanning any member table's QR therefore
 * resolves to that one shared session, so a guest sitting at the far end of a
 * joined row never has to hunt for "the right" QR code.
 *
 * The alternative rule — only the anchor's QR works — is a one-line policy
 * change (see TableGroupPolicy) and needs no schema change.
 */
export const TABLE_GROUP_POLICIES = ['ANY_MEMBER', 'PRIMARY_ONLY'] as const;
export type TableGroupPolicy = (typeof TABLE_GROUP_POLICIES)[number];

export const DEFAULT_TABLE_GROUP_POLICY: TableGroupPolicy = 'ANY_MEMBER';

export interface TableRef {
  readonly id: string;
  readonly tableNumber: string;
}

/**
 * Orders table numbers the way a human reads them: "2" before "10", and a
 * numeric table always before a lettered one ("T1"). Falls back to locale
 * comparison for non-numeric labels so the result is always deterministic.
 */
export function compareTableNumbers(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  const aIsNum = Number.isFinite(na) && /^\s*\d+\s*$/.test(a);
  const bIsNum = Number.isFinite(nb) && /^\s*\d+\s*$/.test(b);

  if (aIsNum && bIsNum) return na - nb || a.localeCompare(b);
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b);
}

/** The anchor table of a combined group: the lowest number among its members. */
export function resolveAnchorTable(members: readonly TableRef[]): TableRef {
  if (members.length === 0) {
    throw domainError('VALIDATION_FAILED', 'A table group must have at least one member table');
  }
  return [...members].sort((a, b) => compareTableNumbers(a.tableNumber, b.tableNumber))[0]!;
}

export interface GroupResolution {
  /** The table whose session the scan belongs to. */
  readonly anchorTable: TableRef;
  /** The table actually scanned — recorded on the order for the waiter. */
  readonly scannedTable: TableRef;
  readonly isCombined: boolean;
}

/**
 * Works out which session a scan belongs to. Under PRIMARY_ONLY a scan of a
 * non-anchor table is refused with the anchor's number, so staff can direct the
 * guest instead of silently opening a second session for a joined table.
 */
export function resolveScanTarget(
  scannedTable: TableRef,
  groupMembers: readonly TableRef[] | null,
  policy: TableGroupPolicy = DEFAULT_TABLE_GROUP_POLICY,
): GroupResolution {
  if (!groupMembers || groupMembers.length === 0) {
    return { anchorTable: scannedTable, scannedTable, isCombined: false };
  }

  const anchorTable = resolveAnchorTable(groupMembers);

  if (policy === 'PRIMARY_ONLY' && anchorTable.id !== scannedTable.id) {
    throw domainError(
      'QR_INVALID',
      'This table is combined; orders run through the anchor table',
      { anchorTableNumber: anchorTable.tableNumber, scannedTableNumber: scannedTable.tableNumber },
    );
  }

  return { anchorTable, scannedTable, isCombined: true };
}
