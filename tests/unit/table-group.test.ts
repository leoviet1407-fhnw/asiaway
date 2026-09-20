import { describe, expect, it } from 'vitest';
import {
  compareTableNumbers,
  resolveAnchorTable,
  resolveScanTarget,
} from '../../src/domain/session/table-group';
import { DomainError } from '../../src/domain/errors';

const t = (id: string, tableNumber: string) => ({ id, tableNumber });

describe('combined tables (decision E4: lowest number anchors the session)', () => {
  it('sorts table numbers the way a human reads them', () => {
    expect(['10', '2', '1'].sort(compareTableNumbers)).toEqual(['1', '2', '10']);
    expect(compareTableNumbers('01', '2')).toBeLessThan(0);
  });

  it('picks the lowest-numbered table as the anchor', () => {
    const anchor = resolveAnchorTable([t('c', '14'), t('a', '11'), t('b', '12')]);
    expect(anchor.tableNumber).toBe('11');
  });

  it('is insensitive to the order members were joined in', () => {
    const members = [t('b', '12'), t('a', '11')];
    expect(resolveAnchorTable(members).id).toBe('a');
    expect(resolveAnchorTable([...members].reverse()).id).toBe('a');
  });

  it('routes a scan of any member table to the anchor session', () => {
    const members = [t('a', '11'), t('b', '12')];
    const res = resolveScanTarget(t('b', '12'), members);
    expect(res.anchorTable.tableNumber).toBe('11');
    expect(res.scannedTable.tableNumber).toBe('12');
    expect(res.isCombined).toBe(true);
  });

  it('leaves an ungrouped table as its own anchor', () => {
    const res = resolveScanTarget(t('z', '05'), null);
    expect(res.anchorTable.id).toBe('z');
    expect(res.isCombined).toBe(false);
  });

  it('supports the stricter PRIMARY_ONLY rule without a schema change', () => {
    const members = [t('a', '11'), t('b', '12')];
    expect(resolveScanTarget(t('a', '11'), members, 'PRIMARY_ONLY').anchorTable.id).toBe('a');
    expect(() => resolveScanTarget(t('b', '12'), members, 'PRIMARY_ONLY')).toThrow(DomainError);
  });

  it('refuses an empty group rather than inventing an anchor', () => {
    expect(() => resolveAnchorTable([])).toThrow(DomainError);
  });
});
