import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { items, suppliers, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { MemoryMailer } from '@/server/mail/mailer';
import { sampleEan, seedSampleData } from '@/server/seed/sample-data';
import { getOrder, openDraft, sendOrder, setLineQty, submitOrder } from '@/server/services/order-service';
import {
  addReceiptPhoto,
  completeReceipt,
  getReceiptPhoto,
  getReceiptView,
  listReceivable,
  startReceipt,
  syncReceiptLines,
} from '@/server/services/receiving-service';
import { interpretScan } from '@/domain/receiving';
import { createTestDatabase } from '../helpers/db';

let db: AppDatabase;
let close: () => Promise<void>;
let staffTh: Principal;
let staffOer: Principal;
let orderer: Principal;
let orderId: string;
const itemId: Record<string, string> = {};

async function principal(email: string): Promise<Principal> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await loadPrincipalForUser(db, u!.id))!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedSampleData(db, { password: 'test-password', withOrders: false });
  staffTh = await principal('winti-th@asiaway.test');
  staffOer = await principal('oerlikon@asiaway.test');
  orderer = await principal('besteller@asiaway.test');
  for (const i of await db.select().from(items)) itemId[i.sku] = i.id;
  const asia = (await db.select().from(suppliers)).find((s) => s.name.startsWith('Muster Asia'))!;

  const { id } = await openDraft(db, staffTh, 'winterthur', asia.id);
  await setLineQty(db, staffTh, id, itemId['A-1005']!, 2); // fish sauce, case of 12
  await setLineQty(db, staffTh, id, itemId['A-1009']!, 2); // coconut milk
  await setLineQty(db, staffTh, id, itemId['A-1010']!, 3); // red curry
  await setLineQty(db, staffTh, id, itemId['A-2001']!, 1); // prawns
  await submitOrder(db, staffTh, id);
  await sendOrder(db, orderer, id, new MemoryMailer(), 'from@x');
  orderId = id;
});
afterAll(async () => close());

describe('goods-in', () => {
  it('lists the sent order only for its location', async () => {
    expect((await listReceivable(db, staffTh)).map((o) => o.id)).toContain(orderId);
    expect((await listReceivable(db, staffOer)).map((o) => o.id)).not.toContain(orderId);
    await expect(startReceipt(db, staffOer, orderId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('records a partial delivery and keeps the order open', async () => {
    const { id: receiptId, created } = await startReceipt(db, staffTh, orderId);
    expect(created).toBe(true);
    expect(await startReceipt(db, staffTh, orderId)).toEqual({ id: receiptId, created: false });

    const view = await getReceiptView(db, staffTh, receiptId);
    const codes = new Map(view.barcodes.map((b) => [b.code, { itemId: b.itemId, unitsPerScan: b.unitsPerScan }]));
    const onOrder = new Set(view.lines.map((l) => l.itemId));

    // Phone-side: scan one case of fish sauce, 12 single bottles, an unknown code and a beer.
    const counts = new Map<string, number>();
    const unknown = new Map<string, number>();
    const scans = [sampleEan('A-1005', 0), ...Array(12).fill(sampleEan('A-1005', 1)), sampleEan('A-1009', 0), '4006381333931', sampleEan('H-4001', 0)];
    for (const raw of scans) {
      const r = interpretScan(raw, codes, onOrder);
      if (r.kind === 'item') counts.set(r.itemId, (counts.get(r.itemId) ?? 0) + r.add);
      if (r.kind === 'unknown') unknown.set(r.code, (unknown.get(r.code) ?? 0) + 1);
    }
    const lines = [
      ...[...counts].map(([itemId, qty]) => ({ itemId, scannedCode: null, qty, damaged: false, note: null })),
      ...[...unknown].map(([code, qty]) => ({ itemId: null, scannedCode: code, qty, damaged: false, note: null })),
      { itemId: itemId['A-2001']!, scannedCode: null, qty: 1, damaged: true, note: 'Karton aufgetaut' },
    ];
    await syncReceiptLines(db, staffTh, receiptId, lines);
    // Resending the same absolute values (e.g. after a dropped connection) changes nothing.
    await syncReceiptLines(db, staffTh, receiptId, lines);

    const after = await getReceiptView(db, staffTh, receiptId);
    const status = Object.fromEntries(after.rows.map((r) => [r.itemId ?? r.scannedCode, r.status]));
    expect(after.rows.find((r) => r.itemId === itemId['A-1005'])!.now).toBe(2);
    expect(status[itemId['A-1005']!]).toBe('OK');
    expect(status[itemId['A-1009']!]).toBe('SHORT');
    expect(status[itemId['A-1010']!]).toBe('MISSING');
    expect(status[itemId['A-2001']!]).toBe('OK');
    expect(status[itemId['H-4001']!]).toBe('WRONG');
    expect(status['4006381333931']).toBe('WRONG');
    expect(after.summary.damaged).toBe(1);

    const photoId = await addReceiptPhoto(db, staffTh, receiptId, 'DELIVERY_NOTE', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect((await getReceiptPhoto(db, staffTh, photoId)).mime).toBe('image/jpeg');
    await expect(addReceiptPhoto(db, staffTh, receiptId, 'DAMAGE', 'text/html', Buffer.from('x'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const result = await completeReceipt(db, staffTh, receiptId, { closeOrder: false });
    expect(result.orderStatus).toBe('PARTIALLY_RECEIVED');
    await expect(syncReceiptLines(db, staffTh, receiptId, lines)).rejects.toMatchObject({ code: 'RECEIPT_CLOSED' });
    await expect(completeReceipt(db, staffTh, receiptId, { closeOrder: false })).rejects.toMatchObject({ code: 'RECEIPT_CLOSED' });
    expect((await getOrder(db, staffTh, orderId)).order.status).toBe('PARTIALLY_RECEIVED');
  });

  it('expects only the rest in the second delivery and then closes the order', async () => {
    const { id: receiptId, created } = await startReceipt(db, staffTh, orderId);
    expect(created).toBe(true);
    const view = await getReceiptView(db, staffTh, receiptId);
    const expected = Object.fromEntries(view.lines.map((l) => [l.itemId, l.expectedNow]));
    expect(expected[itemId['A-1005']!]).toBe(0);
    expect(expected[itemId['A-1009']!]).toBe(1);
    expect(expected[itemId['A-1010']!]).toBe(3);

    await syncReceiptLines(db, staffTh, receiptId, [
      { itemId: itemId['A-1009']!, scannedCode: null, qty: 1, damaged: false, note: null },
      { itemId: itemId['A-1010']!, scannedCode: null, qty: 2, damaged: false, note: null },
    ]);
    // Still one curry short, but staff close the order anyway ("Abschliessen").
    const result = await completeReceipt(db, staffTh, receiptId, { closeOrder: true, note: 'Rest storniert' });
    expect(result.orderStatus).toBe('RECEIVED');
    expect(result.summary.counts.SHORT).toBe(1);
    const order = (await getOrder(db, orderer, orderId)).order;
    expect(order.status).toBe('RECEIVED');
    expect(order.closedAt).not.toBeNull();
    await expect(startReceipt(db, staffTh, orderId)).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });

    // The completed first receipt still shows its own view.
    expect((await listReceivable(db, staffTh)).map((o) => o.id)).not.toContain(orderId);
  });
});
