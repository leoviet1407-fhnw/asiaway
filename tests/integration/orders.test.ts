import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { emailLog, items, purchaseOrders, suppliers, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { MemoryMailer } from '@/server/mail/mailer';
import { seedSampleData } from '@/server/seed/sample-data';
import {
  cancelOrder,
  copyLastOrder,
  getOrder,
  listOrders,
  openDraft,
  orderPdf,
  previewSend,
  returnToDraft,
  sendOrder,
  setLineQty,
  submitOrder,
} from '@/server/services/order-service';
import { createTestDatabase } from '../helpers/db';

let db: AppDatabase;
let close: () => Promise<void>;
let staffOer: Principal;
let staffWvn: Principal;
let orderer: Principal;
let asiaId: string;
let frischId: string;
const itemId: Record<string, string> = {};

async function principal(email: string): Promise<Principal> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await loadPrincipalForUser(db, u!.id))!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedSampleData(db, { password: 'test-password', withOrders: false });
  staffOer = await principal('oerlikon@asiaway.test');
  staffWvn = await principal('winti-vn@asiaway.test');
  orderer = await principal('besteller@asiaway.test');
  for (const s of await db.select().from(suppliers)) {
    if (s.name.startsWith('Muster Asia')) asiaId = s.id;
    if (s.name.startsWith('Muster Frisch')) frischId = s.id;
  }
  for (const i of await db.select().from(items)) itemId[i.sku] = i.id;
});
afterAll(async () => close());

describe('draft orders', () => {
  it('keeps one draft per location and supplier', async () => {
    const a = await openDraft(db, staffOer, 'oerlikon', asiaId);
    const b = await openDraft(db, staffOer, 'oerlikon', asiaId);
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const other = await openDraft(db, staffWvn, 'winti-vn', asiaId);
    expect(other.id).not.toBe(a.id);
  });

  it('refuses another location and items from another supplier', async () => {
    await expect(openDraft(db, staffOer, 'winti-th', asiaId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { id } = await openDraft(db, staffOer, 'oerlikon', asiaId);
    await expect(setLineQty(db, staffOer, id, itemId['F-3001']!, 2)).rejects.toMatchObject({ code: 'ITEM_NOT_FROM_SUPPLIER' });
    await expect(setLineQty(db, staffWvn, id, itemId['A-1001']!, 2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sets, changes and removes lines with a price snapshot', async () => {
    const { id } = await openDraft(db, staffOer, 'oerlikon', asiaId);
    await setLineQty(db, staffOer, id, itemId['A-1001']!, 2);
    await setLineQty(db, staffOer, id, itemId['A-1001']!, 3);
    await setLineQty(db, staffOer, id, itemId['A-1005']!, 1.5);
    await setLineQty(db, staffOer, id, itemId['A-1009']!, 1);
    await setLineQty(db, staffOer, id, itemId['A-1009']!, 0);
    const view = await getOrder(db, staffOer, id);
    expect(view.lines.map((l) => [l.sku, l.qty])).toEqual(
      expect.arrayContaining([
        ['A-1001', 3],
        ['A-1005', 1.5],
      ]),
    );
    expect(view.lines).toHaveLength(2);
    expect(view.totalCents).toBe(3 * 4250 + Math.round(1.5 * 4680));
  });
});

describe('review and send', () => {
  it('runs draft → submitted → sent, emailing a PDF exactly once', async () => {
    const { id } = await openDraft(db, staffOer, 'oerlikon', asiaId);
    await submitOrder(db, staffOer, id);
    // Staff can no longer edit; the orderer can.
    await expect(setLineQty(db, staffOer, id, itemId['A-1001']!, 9)).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    await setLineQty(db, orderer, id, itemId['A-1001']!, 4);
    await expect(sendOrder(db, staffOer, id, new MemoryMailer(), 'from@x')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const preview = await previewSend(db, orderer, id);
    expect(preview.to).toBe('bestellung@muster-asiafood.example');
    expect(preview.subject).toMatch(/^Bestellung AsiaWay Oerlikon – B-\d{4}-\d{4}/);
    expect(preview.text).toContain('Kundennummer: K-10457');

    const mailer = new MemoryMailer();
    await sendOrder(db, orderer, id, mailer, 'AsiaWay <bestellung@asiaway.ch>');
    await expect(sendOrder(db, orderer, id, mailer, 'from@x')).rejects.toMatchObject({ code: 'ALREADY_SENT' });
    expect(mailer.sent).toHaveLength(1);
    const msg = mailer.sent[0]!;
    expect(msg.replyTo).toBe(orderer.email);
    expect(msg.text).toContain('4 × Sack 20 kg');
    const pdfBytes = msg.attachments![0]!.content;
    expect(Buffer.from(pdfBytes).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1);

    const view = await getOrder(db, orderer, id);
    expect(view.order.status).toBe('SENT');
    expect(view.order.sentTo).toBe('bestellung@muster-asiafood.example');
    expect(view.sentBy?.name).toBe(orderer.name);
    const archived = await orderPdf(db, staffOer, id);
    expect(Buffer.from(archived.data).equals(Buffer.from(pdfBytes))).toBe(true);
    const log = await db.select().from(emailLog).where(eq(emailLog.orderId, id));
    expect(log).toHaveLength(1);

    // A new draft for the same supplier can now be opened.
    const next = await openDraft(db, staffOer, 'oerlikon', asiaId);
    expect(next.id).not.toBe(id);
    expect(await copyLastOrder(db, staffOer, next.id)).toBe(2);
    expect((await getOrder(db, staffOer, next.id)).lines.find((l) => l.sku === 'A-1001')?.qty).toBe(4);
  });

  it('keeps the order SUBMITTED when the email fails', async () => {
    const { id } = await openDraft(db, staffWvn, 'winti-vn', frischId);
    await setLineQty(db, staffWvn, id, itemId['F-3001']!, 10);
    await submitOrder(db, staffWvn, id);
    const mailer = new MemoryMailer();
    mailer.failNext = true;
    await expect(sendOrder(db, orderer, id, mailer, 'from@x')).rejects.toMatchObject({ code: 'MAIL_FAILED' });
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    expect(row!.status).toBe('SUBMITTED');
    expect(row!.sentPdf).toBeNull();
    await sendOrder(db, orderer, id, mailer, 'from@x');
    expect(mailer.sent).toHaveLength(1);
  });

  it('refuses to submit an empty draft; orderer can return and cancel', async () => {
    const { id } = await openDraft(db, staffWvn, 'winti-vn', asiaId);
    // This draft was created in the first test; empty it.
    for (const line of (await getOrder(db, staffWvn, id)).lines) await setLineQty(db, staffWvn, id, line.itemId, 0);
    await expect(submitOrder(db, staffWvn, id)).rejects.toMatchObject({ code: 'EMPTY_ORDER' });
    await setLineQty(db, staffWvn, id, itemId['A-1014']!, 1);
    await submitOrder(db, staffWvn, id);
    await expect(returnToDraft(db, staffWvn, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await returnToDraft(db, orderer, id);
    expect((await getOrder(db, staffWvn, id)).order.status).toBe('DRAFT');
    await cancelOrder(db, staffWvn, id);
    expect((await getOrder(db, staffWvn, id)).order.status).toBe('CANCELLED');
  });

  it('shows staff only their own locations', async () => {
    const mine = await listOrders(db, staffOer);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((o) => o.locationId === 'oerlikon')).toBe(true);
    const all = await listOrders(db, orderer);
    expect(new Set(all.map((o) => o.locationId)).size).toBeGreaterThan(1);
    const theirs = all.find((o) => o.locationId === 'winti-vn')!;
    await expect(getOrder(db, staffOer, theirs.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
