import { describe, expect, it } from 'vitest';
import { gtinCheckDigit, isAcceptableScan, isValidGtin, makeEan13, normalizeCode } from '@/domain/ean';
import {
  belowMinimum,
  canCancelOrder,
  canEditOrder,
  canReceiveOrder,
  canSendOrder,
  canTransition,
  formatOrderNumber,
  orderTotalCents,
} from '@/domain/order';
import { formatChf, parseChfToCents, parseQty } from '@/domain/qty';
import {
  ScanDebouncer,
  classifyLine,
  computeDiscrepancies,
  interpretScan,
  orderStatusAfterReceipt,
  summarize,
} from '@/domain/receiving';
import { canAccessLocation, isOrderer, isRestaurant, locationsFor, type Principal } from '@/domain/roles';

const staffOer: Principal = { userId: 'u1', name: 'A', email: 'a@x', grants: [{ role: 'STAFF', locationId: 'oerlikon' }] };
const orderer: Principal = { userId: 'u2', name: 'B', email: 'b@x', grants: [{ role: 'ORDERER', locationId: null }] };
const admin: Principal = { userId: 'u3', name: 'C', email: 'c@x', grants: [{ role: 'ADMIN', locationId: null }] };

describe('EAN', () => {
  it('computes and validates check digits', () => {
    expect(gtinCheckDigit('400638133393')).toBe(1);
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(makeEan13('200100100000')).toMatch(/^\d{13}$/);
    expect(isValidGtin(makeEan13('200100100000'))).toBe(true);
  });
  it('normalises UPC-A and accepts non-numeric labels', () => {
    expect(normalizeCode(' 036000291452 ')).toBe('0036000291452');
    expect(isAcceptableScan('036000291452')).toBe(true);
    expect(isAcceptableScan('LABEL-F-3001')).toBe(true);
    expect(isAcceptableScan('12345')).toBe(false);
    expect(isAcceptableScan('')).toBe(false);
  });
});

describe('quantities and money', () => {
  it('parses German decimals', () => {
    expect(parseQty('2,5')).toBe(2.5);
    expect(parseQty('0.3333')).toBe(0.333);
    expect(parseQty('-1')).toBeNull();
    expect(parseQty('abc')).toBeNull();
    expect(parseQty('')).toBeNull();
  });
  it('formats and parses CHF', () => {
    expect(parseChfToCents('12,50')).toBe(1250);
    expect(parseChfToCents("1'250.00")).toBe(125000);
    expect(formatChf(4680)).toContain('46.80');
  });
});

describe('roles', () => {
  it('limits staff to their location', () => {
    expect(canAccessLocation(staffOer, 'oerlikon')).toBe(true);
    expect(canAccessLocation(staffOer, 'winti-vn')).toBe(false);
    expect(canAccessLocation(orderer, 'winti-th')).toBe(true);
    expect(isOrderer(staffOer)).toBe(false);
    expect(isOrderer(admin)).toBe(true);
    expect(locationsFor(staffOer, [{ id: 'oerlikon' }, { id: 'winti-vn' }]).map((l) => l.id)).toEqual(['oerlikon']);
  });
});

describe('Winterthur orders together', () => {
  const vn: Principal = { userId: 'v', name: 'V', email: 'v@x', grants: [{ role: 'STAFF', locationId: 'winti-vn' }] };
  const th: Principal = { userId: 't', name: 'T', email: 't@x', grants: [{ role: 'STAFF', locationId: 'winti-th' }] };
  it('lets staff of both restaurants order and receive for the building, but not for Oerlikon', () => {
    expect(canAccessLocation(vn, 'winterthur')).toBe(true);
    expect(canAccessLocation(th, 'winterthur')).toBe(true);
    expect(canAccessLocation(vn, 'winti-th')).toBe(false); // closing and stock stay per restaurant
    expect(canAccessLocation(vn, 'oerlikon')).toBe(false);
    expect(canAccessLocation(staffOer, 'winterthur')).toBe(false);
    expect(canEditOrder(th, { status: 'DRAFT', locationId: 'winterthur' })).toBe(true);
    expect(isRestaurant('winterthur')).toBe(false);
    expect(isRestaurant('winti-vn')).toBe(true);
  });
});

describe('order workflow rules', () => {
  it('allows only the agreed transitions', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransition('DRAFT', 'SENT')).toBe(false);
    expect(canTransition('SUBMITTED', 'SENT')).toBe(true);
    expect(canTransition('SUBMITTED', 'DRAFT')).toBe(true);
    expect(canTransition('SENT', 'DRAFT')).toBe(false);
    expect(canTransition('RECEIVED', 'CANCELLED')).toBe(false);
  });
  it('lets staff edit drafts only, orderers also submitted orders', () => {
    const draft = { status: 'DRAFT' as const, locationId: 'oerlikon' };
    const submitted = { status: 'SUBMITTED' as const, locationId: 'oerlikon' };
    expect(canEditOrder(staffOer, draft)).toBe(true);
    expect(canEditOrder(staffOer, { ...draft, locationId: 'winti-th' })).toBe(false);
    expect(canEditOrder(staffOer, submitted)).toBe(false);
    expect(canEditOrder(orderer, submitted)).toBe(true);
    expect(canSendOrder(staffOer, submitted)).toBe(false);
    expect(canSendOrder(orderer, submitted)).toBe(true);
    expect(canSendOrder(orderer, draft)).toBe(false);
    expect(canCancelOrder(staffOer, submitted)).toBe(false);
    expect(canReceiveOrder(staffOer, { status: 'SENT', locationId: 'oerlikon' })).toBe(true);
    expect(canReceiveOrder(staffOer, { status: 'SENT', locationId: 'winti-vn' })).toBe(false);
  });
  it('totals and minimum order', () => {
    expect(orderTotalCents([{ qty: 2, unitPriceCents: 4250 }, { qty: 2.5, unitPriceCents: 3800 }])).toBe(8500 + 9500);
    expect(belowMinimum(10000, 25000)).toBe(true);
    expect(belowMinimum(10000, 0)).toBe(false);
    expect(formatOrderNumber(2026, 7)).toBe('B-2026-0007');
  });
});

describe('discrepancies', () => {
  it('classifies lines', () => {
    expect(classifyLine(10, 0, false)).toBe('MISSING');
    expect(classifyLine(10, 4, false)).toBe('SHORT');
    expect(classifyLine(10, 10, false)).toBe('OK');
    expect(classifyLine(10, 11, false)).toBe('EXTRA');
    expect(classifyLine(6.5, 6.3, true)).toBe('OK'); // within 5 % for fresh goods
    expect(classifyLine(6.5, 6.0, true)).toBe('SHORT');
    expect(classifyLine(6.5, 6.3, false)).toBe('SHORT');
    expect(classifyLine(0, 1, false)).toBe('WRONG');
  });

  it('finds missing, short, extra, wrong and unknown', () => {
    const ordered = [
      { itemId: 'rice', qty: 3, isFresh: false },
      { itemId: 'fish', qty: 2, isFresh: false },
      { itemId: 'coco', qty: 4, isFresh: false },
      { itemId: 'curry', qty: 1, isFresh: false },
      { itemId: 'beef', qty: 6.5, isFresh: true },
    ];
    const rows = computeDiscrepancies(ordered, new Map(), [
      { itemId: 'rice', scannedCode: null, qty: 3 },
      { itemId: 'fish', scannedCode: null, qty: 1 },
      { itemId: 'coco', scannedCode: null, qty: 5, damaged: true },
      { itemId: 'beef', scannedCode: null, qty: 6.4 },
      { itemId: 'beer', scannedCode: null, qty: 1 },
      { itemId: null, scannedCode: '2099999000005', qty: 2 },
    ]);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.rice!.status).toBe('OK');
    expect(byKey.fish!.status).toBe('SHORT');
    expect(byKey.fish!.open).toBe(1);
    expect(byKey.coco!.status).toBe('EXTRA');
    expect(byKey.coco!.damaged).toBe(true);
    expect(byKey.curry!.status).toBe('MISSING');
    expect(byKey.beef!.status).toBe('OK');
    expect(byKey.beer!.status).toBe('WRONG');
    expect(byKey.beer!.onOrder).toBe(false);
    expect(byKey['code:2099999000005']!.status).toBe('WRONG');

    const summary = summarize(rows);
    expect(summary.counts).toEqual({ OK: 2, MISSING: 1, SHORT: 1, EXTRA: 1, WRONG: 2 });
    expect(summary.complete).toBe(false);
    expect(summary.allOk).toBe(false);
    expect(orderStatusAfterReceipt(rows, false)).toBe('PARTIALLY_RECEIVED');
    expect(orderStatusAfterReceipt(rows, true)).toBe('RECEIVED');
  });

  it('counts earlier deliveries of the same order', () => {
    const ordered = [{ itemId: 'fish', qty: 2, isFresh: false }];
    const rows = computeDiscrepancies(ordered, new Map([['fish', 1]]), [{ itemId: 'fish', scannedCode: null, qty: 1 }]);
    expect(rows[0]).toMatchObject({ before: 1, now: 1, total: 2, open: 0, status: 'OK' });
    expect(orderStatusAfterReceipt(rows, false)).toBe('RECEIVED');
  });

  it('ignores zero lines that were not ordered', () => {
    const rows = computeDiscrepancies([], new Map(), [{ itemId: 'x', scannedCode: null, qty: 0 }]);
    expect(rows).toEqual([]);
    expect(summarize(rows).allOk).toBe(true);
  });
});

describe('scanning', () => {
  const case12 = makeEan13('200100500000');
  const piece = makeEan13('210100500000');
  const barcodes = new Map([
    [case12, { itemId: 'fish', unitsPerScan: 1 }],
    [piece, { itemId: 'fish', unitsPerScan: 1 / 12 }],
  ]);
  it('interprets scans', () => {
    expect(interpretScan(case12, barcodes, new Set(['fish']))).toMatchObject({ kind: 'item', itemId: 'fish', add: 1, onOrder: true });
    expect(interpretScan(piece, barcodes, new Set())).toMatchObject({ kind: 'item', onOrder: false });
    expect(interpretScan('4006381333931', barcodes, new Set())).toMatchObject({ kind: 'unknown' });
    expect(interpretScan('4006381333932', barcodes, new Set())).toMatchObject({ kind: 'invalid' });
  });
  it('debounces a pack held in front of the camera', () => {
    const d = new ScanDebouncer(1500);
    expect(d.accept('a', 0)).toBe(true);
    expect(d.accept('a', 300)).toBe(false);
    expect(d.accept('a', 1000)).toBe(false); // still in view
    expect(d.accept('b', 1100)).toBe(true);
    expect(d.accept('a', 3000)).toBe(true);
  });
});
