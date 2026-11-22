import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { suppliers, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { createItem, getItem, listItems, updateItem, type ItemCreate } from '@/server/services/catalog-service';
import { createTestDatabase } from '../helpers/db';

let db: AppDatabase;
let close: () => Promise<void>;
let orderer: Principal;
let staff: Principal;
let supplierA: string;
let supplierB: string;

async function principal(email: string): Promise<Principal> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await loadPrincipalForUser(db, u!.id))!;
}

const base = (over: Partial<ItemCreate> = {}): ItemCreate => ({
  sku: null,
  nameDe: 'Reisnudeln 3 mm',
  nameVi: 'Bánh phở',
  nameEn: 'Rice noodles',
  storageArea: 'DRY',
  stockUnit: 'Pack',
  isFresh: false,
  isKeyItem: false,
  department: 'KÜCHE',
  itemGroup: 'FOOD',
  barcodes: [],
  offer: { supplierId: supplierA, supplierSku: 'X-1', orderUnit: 'Karton', quantityUnit: 'Karton', packSize: 10, priceCents: 4550 },
  ...over,
});

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedSampleData(db, { password: 'test-password', withOrders: false });
  orderer = await principal('besteller@asiaway.test');
  staff = await principal('oerlikon@asiaway.test');
  const all = await db.select().from(suppliers);
  supplierA = all[0]!.id;
  supplierB = all[1]!.id;
}, 60_000);

afterAll(async () => close());

describe('products', () => {
  it('an orderer creates a product with its first supplier and an automatic number', async () => {
    const id = await createItem(db, orderer, base());
    const item = await getItem(db, id);
    expect(item.sku).toMatch(/^N-\d+$/);
    expect(item.nameEn).toBe('Rice noodles');
    expect(item.offers).toHaveLength(1);
    expect(item.offers[0]).toMatchObject({ supplierId: supplierA, priceCents: 4550, packSize: 10, active: true });
    const second = await createItem(db, orderer, base({ nameDe: 'Glasnudeln' }));
    expect(Number((await getItem(db, second)).sku.slice(2))).toBe(Number(item.sku.slice(2)) + 1);
    // It shows up in the supplier's order list
    expect((await listItems(db, { supplierId: supplierA })).some((i) => i.id === id)).toBe(true);
  });

  it('staff cannot create products; duplicate numbers and bad barcodes are refused', async () => {
    await expect(createItem(db, staff, base())).rejects.toThrow();
    await createItem(db, orderer, base({ sku: 'OWN-1' }));
    await expect(createItem(db, orderer, base({ sku: 'OWN-1' }))).rejects.toThrow(/gibt es schon/);
    await expect(createItem(db, orderer, base({ barcodes: [{ code: '7610000000002', unitsPerScan: 1 }] }))).rejects.toThrow(/Prüfziffer/);
  });

  it('adds a second supplier, then removes the first one', async () => {
    const id = await createItem(db, orderer, base({ nameDe: 'Sojasauce' }));
    const item = await getItem(db, id);
    const keep = { nameDe: item.nameDe, nameVi: item.nameVi, nameEn: item.nameEn, storageArea: item.storageArea, stockUnit: item.stockUnit, isFresh: false, isKeyItem: false, department: null, itemGroup: null, active: true, barcodes: [] };
    const offers = item.offers.map((o) => ({ supplierItemId: o.supplierItemId, priceCents: o.priceCents, orderUnit: o.orderUnit, quantityUnit: o.quantityUnit, supplierSku: o.supplierSku }));
    await updateItem(db, orderer, id, { ...keep, offers, newOffer: { supplierId: supplierB, supplierSku: null, orderUnit: 'Flasche', quantityUnit: null, packSize: 1, priceCents: 390 } });
    expect((await getItem(db, id)).offers.filter((o) => o.active).map((o) => o.supplierId).sort()).toEqual([supplierA, supplierB].sort());

    await updateItem(db, orderer, id, { ...keep, offers: [], removeOfferIds: [item.offers[0]!.supplierItemId] });
    const after = await getItem(db, id);
    expect(after.offers.filter((o) => o.active).map((o) => o.supplierId)).toEqual([supplierB]);
    expect((await listItems(db, { supplierId: supplierA })).some((i) => i.id === id)).toBe(false);

    // The last supplier of an active item cannot be removed
    const last = after.offers.find((o) => o.active)!;
    await expect(updateItem(db, orderer, id, { ...keep, offers: [], removeOfferIds: [last.supplierItemId] })).rejects.toThrow(/mindestens einen Lieferanten/);
  });
});
