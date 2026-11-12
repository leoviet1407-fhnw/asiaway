/**
 * Adds the SAMPLE suppliers and items (no sample users, no orders) to a
 * database, plus one extra test article, EAN 8854698006347.
 *
 *   DATABASE_URL=postgres://… npm run seed:catalog
 *
 * Only for an EMPTY catalog: it refuses if suppliers already exist.
 */
import { itemBarcodes, items, supplierItems, suppliers } from '../src/server/db/schema';
import { seedSampleData } from '../src/server/seed/sample-data';
import { openCliDatabase } from './cli-db';

const { db, close } = await openCliDatabase();
try {
  if ((await db.select({ id: suppliers.id }).from(suppliers).limit(1)).length > 0) {
    console.log('Suppliers already exist – nothing added.');
  } else {
    await seedSampleData(db, { withUsers: false, withOrders: false });
    const [asia] = await db.select().from(suppliers).limit(1);
    const [it] = await db
      .insert(items)
      .values({ sku: 'T-0001', nameDe: 'Testartikel (EAN 8854698006347)', nameVi: null, storageArea: 'DRY', stockUnit: 'Stk', isKeyItem: true })
      .returning({ id: items.id });
    await db.insert(supplierItems).values({ supplierId: asia!.id, itemId: it!.id, supplierSku: 'TEST-1', orderUnit: 'Karton à 12', packSize: '12', priceCents: 2400 });
    await db.insert(itemBarcodes).values([
      { code: '8854698006347', itemId: it!.id, unitsPerScan: '1', label: 'Karton' },
    ]);
    console.log('Sample suppliers + items added, plus test article 8854698006347.');
  }
} finally {
  await close();
}
