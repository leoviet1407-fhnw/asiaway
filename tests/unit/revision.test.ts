import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../src/domain/order/snapshot';
import { diffSnapshots, hasMaterialChanges, planRevision } from '../../src/domain/order/revision';

const pho = {
  menuItemId: 'item-pho',
  dishNumber: '40',
  nameEn: 'Beef Noodle Soup',
  nameDe: 'Rindfleisch-Nudelsuppe',
  nameVi: 'Phở bò',
  unitPriceCents: 2450,
  allergenCodes: ['D', 'F'],
};
const coke = {
  menuItemId: 'item-coke',
  dishNumber: null,
  nameEn: 'Coke',
  nameDe: 'Cola',
  nameVi: 'Coca',
  unitPriceCents: 500,
  allergenCodes: [],
};
const coffee = {
  menuItemId: 'item-coffee',
  dishNumber: null,
  nameEn: 'Vietnamese Coffee',
  nameDe: 'Vietnamesischer Kaffee',
  nameVi: 'Cà phê sữa đá',
  unitPriceCents: 550,
  allergenCodes: [],
};

describe('revision engine', () => {
  it('recomputes totals from unit price and quantity', () => {
    const snap = buildSnapshot({
      status: 'SUBMITTED',
      items: [{ ...pho, quantity: 2 }, { ...coke, quantity: 1 }],
    });
    expect(snap.items[0]!.lineTotalCents).toBe(4900);
    expect(snap.totalCents).toBe(5400);
  });

  it('tracks the worked example from the brief across three revisions', () => {
    const original = buildSnapshot({
      status: 'SUBMITTED',
      items: [{ ...pho, quantity: 2 }, { ...coke, quantity: 1 }],
    });
    const rev1 = buildSnapshot({
      status: 'EMPLOYEE_REVIEW',
      items: [{ ...pho, quantity: 1 }, { ...coke, quantity: 1 }],
    });
    const rev2 = buildSnapshot({
      status: 'EMPLOYEE_REVIEW',
      items: [{ ...pho, quantity: 1 }, { ...coke, quantity: 1 }, { ...coffee, quantity: 1 }],
    });

    expect(original.totalCents).toBe(5400);
    expect(rev1.totalCents).toBe(2950);
    expect(rev2.totalCents).toBe(3500);

    // The order was opened for review between the submission and the first
    // edit, so this diff legitimately carries a status change too. Only the
    // material change drives the revision.
    const plan1 = planRevision(original, rev1, 'WAITER_EDIT');
    expect(plan1.changes.map((c) => c.kind).sort()).toEqual([
      'ITEM_QUANTITY_CHANGED',
      'STATUS_CHANGED',
    ]);
    expect(plan1.materialChanges).toHaveLength(1);
    expect(plan1.materialChanges[0]).toMatchObject({
      kind: 'ITEM_QUANTITY_CHANGED',
      before: 2,
      after: 1,
    });
    expect(plan1.totalCentsBefore).toBe(5400);
    expect(plan1.totalCentsAfter).toBe(2950);

    const d2 = diffSnapshots(rev1, rev2);
    expect(d2).toHaveLength(1);
    expect(d2[0]).toMatchObject({ kind: 'ITEM_ADDED', label: 'Vietnamese Coffee' });

    // The original is still reconstructable from its own snapshot, untouched.
    expect(original.items.find((i) => i.menuItemId === 'item-pho')!.quantity).toBe(2);
  });

  it('detects removals', () => {
    const before = buildSnapshot({ status: 'SUBMITTED', items: [{ ...pho, quantity: 1 }, { ...coke, quantity: 1 }] });
    const after = buildSnapshot({ status: 'SUBMITTED', items: [{ ...pho, quantity: 1 }] });
    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'ITEM_REMOVED', label: 'Coke' });
  });

  it('detects note changes on both sides', () => {
    const before = buildSnapshot({ status: 'SUBMITTED', items: [{ ...pho, quantity: 1 }], customerNote: 'No coriander, please.' });
    const after = buildSnapshot({ status: 'SUBMITTED', items: [{ ...pho, quantity: 1 }], customerNote: 'No coriander, please.', waiterNote: 'Table asked for extra chilli' });
    const changes = diffSnapshots(before, after);
    expect(changes.map((c) => c.kind)).toEqual(['WAITER_NOTE_CHANGED']);
  });

  it('treats a bare status change as non-material, so revisions stay meaningful', () => {
    const before = buildSnapshot({ status: 'SUBMITTED', items: [{ ...pho, quantity: 1 }] });
    const after = buildSnapshot({ status: 'EMPLOYEE_REVIEW', items: [{ ...pho, quantity: 1 }] });
    const changes = diffSnapshots(before, after);
    expect(changes.map((c) => c.kind)).toEqual(['STATUS_CHANGED']);
    expect(hasMaterialChanges(changes)).toBe(false);
    expect(planRevision(before, after, 'WAITER_EDIT').shouldCreateRevision).toBe(false);
  });

  it('always records a revision for confirmation, even with no content change', () => {
    const snap = buildSnapshot({ status: 'EMPLOYEE_REVIEW', items: [{ ...pho, quantity: 1 }] });
    expect(planRevision(snap, snap, 'FINAL_CONFIRMED').shouldCreateRevision).toBe(true);
  });

  it('normalises blank notes to null so whitespace is not a "change"', () => {
    const a = buildSnapshot({ status: 'SUBMITTED', items: [{ ...pho, quantity: 1 }], customerNote: '   ' });
    const b = buildSnapshot({ status: 'SUBMITTED', items: [{ ...pho, quantity: 1 }], customerNote: null });
    expect(diffSnapshots(a, b)).toHaveLength(0);
  });
});
