import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { itemBarcodes, items, locations, suppliers, userRoles, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { MemoryMailer } from '@/server/mail/mailer';
import { seedSampleData } from '@/server/seed/sample-data';
import { getItem, itemsWithoutBarcode, updateItem } from '@/server/services/catalog-service';
import { notifyReview, openDraft, reviewRecipients, setLineQty, submitOrder } from '@/server/services/order-service';
import { createTestDatabase } from '../helpers/db';

let db: AppDatabase;
let close: () => Promise<void>;
let staff: Principal;
let planner: Principal;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedSampleData(db, { password: 'test-password', withOrders: false });
  const [u] = await db.select().from(users).where(eq(users.email, 'oerlikon@asiaway.test'));
  staff = (await loadPrincipalForUser(db, u!.id))!;
  // A planner without the order-approval right (like Belle)
  const [b] = await db.insert(users).values({ email: 'belle@asiaway.test', name: 'Belle', passwordHash: 'x' }).returning({ id: users.id });
  await db.insert(userRoles).values({ userId: b!.id, role: 'PLANNER', locationId: null });
  planner = (await loadPrincipalForUser(db, b!.id))!;
}, 60_000);

afterAll(async () => close());

describe('review e-mail', () => {
  it('reads the addresses from REVIEW_NOTIFY_EMAILS', () => {
    expect(reviewRecipients({ REVIEW_NOTIFY_EMAILS: 'xuan@example.test, bad, b@example.test' } as unknown as NodeJS.ProcessEnv)).toEqual(['xuan@example.test', 'b@example.test']);
    expect(reviewRecipients({} as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('a submitted order sends one short e-mail from the restaurant mailbox with a link', async () => {
    const [sup] = await db.select().from(suppliers).limit(1);
    const [item] = await db.select().from(items).limit(1);
    await db.update(locations).set({ contactEmail: 'rezh@example.test' }).where(eq(locations.id, 'oerlikon'));
    const { id } = await openDraft(db, staff, 'oerlikon', sup!.id);
    await setLineQty(db, staff, id, item!.id, 2);
    await submitOrder(db, staff, id);
    const shop = new MemoryMailer();
    const fallback = new MemoryMailer();
    const ok = await notifyReview(db, staff, id, {
      recipients: ['xuan@example.test'],
      appUrl: 'https://app.example.test',
      pickSender: (loc) => ({ mailer: shop, from: `AsiaWay ${loc.name} <${loc.contactEmail}>` }),
      mailer: fallback,
      from: 'x@example.test',
    });
    expect(ok).toBe(true);
    expect(fallback.sent).toHaveLength(0);
    expect(shop.sent).toHaveLength(1);
    const m = shop.sent[0]!;
    expect(m.to).toBe('xuan@example.test');
    expect(m.from).toBe('AsiaWay Oerlikon <rezh@example.test>');
    expect(m.subject).toMatch(/^Zur Prüfung: B-\d{4}-\d+ · Oerlikon · .+ \(1 Positionen\)$/);
    expect(m.text).toContain(`https://app.example.test/bestellungen/${id}`);
    expect(m.text).toContain('Mitarbeiter Oerlikon');
  });

  it('a mail problem never breaks the submit', async () => {
    const broken = new MemoryMailer();
    broken.failNext = true;
    const [sup] = await db.select().from(suppliers).limit(1);
    const [item] = await db.select().from(items).limit(1);
    const { id } = await openDraft(db, staff, 'oerlikon', sup!.id);
    await setLineQty(db, staff, id, item!.id, 1);
    await submitOrder(db, staff, id);
    expect(await notifyReview(db, staff, id, { recipients: ['xuan@example.test'], appUrl: '', mailer: broken, from: 'x@example.test' })).toBe(false);
    expect(await notifyReview(db, staff, id, { recipients: [], appUrl: '', mailer: broken, from: 'x@example.test' })).toBe(false);
  });
});

describe('barcode task', () => {
  it('lists packaged items without a barcode; fresh goods do not count', async () => {
    const before = await itemsWithoutBarcode(db);
    const all = await db.select().from(items);
    for (const i of before) expect(all.find((x) => x.id === i.id)!.isFresh).toBe(false);
    const codes = await db.select().from(itemBarcodes);
    for (const i of before) expect(codes.some((c) => c.itemId === i.id)).toBe(false);
  });

  it('a planner (Belle) can add a barcode; plain staff cannot', async () => {
    // Make sure one packaged item has no barcode
    const packaged = (await db.select().from(items).where(eq(items.isFresh, false)))[0]!;
    await db.delete(itemBarcodes).where(eq(itemBarcodes.itemId, packaged.id));
    const target = (await itemsWithoutBarcode(db)).find((x) => x.id === packaged.id);
    expect(target).toBeTruthy();
    const item = await getItem(db, target!.id);
    const update = {
      nameDe: item.nameDe, nameVi: item.nameVi, nameEn: item.nameEn, storageArea: item.storageArea, stockUnit: item.stockUnit,
      isFresh: item.isFresh, isKeyItem: item.isKeyItem, department: item.department, itemGroup: item.itemGroup, active: true,
      barcodes: [{ code: '4006381333931', unitsPerScan: 1 }],
      offers: item.offers.filter((o) => o.active).map((o) => ({ supplierItemId: o.supplierItemId, priceCents: o.priceCents, orderUnit: o.orderUnit, quantityUnit: o.quantityUnit, supplierSku: o.supplierSku })),
    };
    await expect(updateItem(db, staff, item.id, update)).rejects.toThrow();
    await updateItem(db, planner, item.id, update);
    expect((await itemsWithoutBarcode(db)).some((x) => x.id === item.id)).toBe(false);
  });
});
