import { and, asc, eq, inArray } from 'drizzle-orm';
import { isValidGtin, normalizeCode } from '../../domain/ean';
import { domainError } from '../../domain/errors';
import { isAdmin, isRestaurant, type Principal } from '../../domain/roles';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { itemBarcodes, items, locations, supplierItems, suppliers } from '../db/schema';

export type StorageArea = 'COLD' | 'FREEZER' | 'DRY' | 'BAR';

export const STORAGE_AREA_LABEL: Record<StorageArea, string> = {
  COLD: 'Kühlraum',
  FREEZER: 'Tiefkühler',
  DRY: 'Trockenlager',
  BAR: 'Bar',
};
export const STORAGE_AREA_ORDER: StorageArea[] = ['COLD', 'FREEZER', 'DRY', 'BAR'];

export async function listLocations(db: AppDatabase) {
  return db.select().from(locations).orderBy(asc(locations.sort));
}

/** Where orders are placed: Oerlikon and Winterthur (both Winterthur restaurants together). */
export async function listOrderLocations(db: AppDatabase) {
  return (await listLocations(db)).filter((l) => l.id === 'oerlikon' || l.id === 'winterthur');
}

/** The restaurants themselves (daily closing, later stock). */
export async function listRestaurants(db: AppDatabase) {
  return (await listLocations(db)).filter((l) => isRestaurant(l.id));
}

export async function listSuppliers(db: AppDatabase, { includeInactive = false } = {}) {
  const rows = await db.select().from(suppliers).orderBy(asc(suppliers.name));
  return includeInactive ? rows : rows.filter((s) => s.active);
}

export async function getSupplier(db: AppDatabase, id: string) {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!row) throw domainError('NOT_FOUND', 'Supplier not found');
  return row;
}

export interface CatalogItem {
  id: string;
  sku: string;
  nameDe: string;
  nameVi: string | null;
  storageArea: StorageArea;
  stockUnit: string;
  isFresh: boolean;
  isKeyItem: boolean;
  active: boolean;
  barcodes: { code: string; unitsPerScan: number; label: string | null }[];
  offers: {
    supplierItemId: string;
    supplierId: string;
    supplierName: string;
    supplierSku: string | null;
    orderUnit: string;
    packSize: number;
    priceCents: number;
  }[];
}

/** All items with their barcodes and supplier offers (≈100 items: one query each). */
export async function listItems(db: AppDatabase, { supplierId, includeInactive = false }: { supplierId?: string; includeInactive?: boolean } = {}): Promise<CatalogItem[]> {
  const itemRows = await db.select().from(items).orderBy(asc(items.nameDe));
  const codes = await db.select().from(itemBarcodes);
  const offers = await db
    .select({
      supplierItemId: supplierItems.id,
      itemId: supplierItems.itemId,
      supplierId: supplierItems.supplierId,
      supplierName: suppliers.name,
      supplierSku: supplierItems.supplierSku,
      orderUnit: supplierItems.orderUnit,
      packSize: supplierItems.packSize,
      priceCents: supplierItems.priceCents,
      active: supplierItems.active,
    })
    .from(supplierItems)
    .innerJoin(suppliers, eq(suppliers.id, supplierItems.supplierId));

  const result: CatalogItem[] = itemRows
    .filter((i) => includeInactive || i.active)
    .map((i) => ({
      id: i.id,
      sku: i.sku,
      nameDe: i.nameDe,
      nameVi: i.nameVi,
      storageArea: i.storageArea as StorageArea,
      stockUnit: i.stockUnit,
      isFresh: i.isFresh,
      isKeyItem: i.isKeyItem,
      active: i.active,
      barcodes: codes
        .filter((c) => c.itemId === i.id)
        .map((c) => ({ code: c.code, unitsPerScan: Number(c.unitsPerScan), label: c.label })),
      offers: offers
        .filter((o) => o.itemId === i.id && (includeInactive || o.active))
        .map((o) => ({
          supplierItemId: o.supplierItemId,
          supplierId: o.supplierId,
          supplierName: o.supplierName,
          supplierSku: o.supplierSku,
          orderUnit: o.orderUnit,
          packSize: Number(o.packSize),
          priceCents: o.priceCents,
        })),
    }));
  return supplierId ? result.filter((i) => i.offers.some((o) => o.supplierId === supplierId)) : result;
}

export async function getItem(db: AppDatabase, id: string): Promise<CatalogItem> {
  const all = await listItems(db, { includeInactive: true });
  const item = all.find((i) => i.id === id);
  if (!item) throw domainError('NOT_FOUND', 'Item not found');
  return item;
}

function requireAdmin(p: Principal) {
  if (!isAdmin(p)) throw domainError('FORBIDDEN', 'Admins only');
}

export interface ItemUpdate {
  nameDe: string;
  nameVi: string | null;
  storageArea: StorageArea;
  stockUnit: string;
  isFresh: boolean;
  isKeyItem: boolean;
  active: boolean;
  /** Codes with their units per scan; replaces the item's barcodes. */
  barcodes: { code: string; unitsPerScan: number }[];
  /** Price per order unit for each existing offer. */
  offers: { supplierItemId: string; priceCents: number; orderUnit: string; supplierSku: string | null }[];
}

export async function updateItem(db: AppDatabase, p: Principal, id: string, update: ItemUpdate): Promise<void> {
  requireAdmin(p);
  if (!update.nameDe.trim()) throw domainError('VALIDATION_FAILED', 'Name fehlt');
  const codes = update.barcodes.map((b) => ({ ...b, code: normalizeCode(b.code) })).filter((b) => b.code);
  for (const b of codes) {
    if (/^\d+$/.test(b.code) && !isValidGtin(b.code)) {
      throw domainError('VALIDATION_FAILED', `Ungültiger Barcode ${b.code} (Prüfziffer)`, { code: b.code });
    }
    if (!(b.unitsPerScan > 0)) throw domainError('VALIDATION_FAILED', 'Menge pro Scan muss > 0 sein');
  }
  if (codes.length > 0) {
    const taken = await db
      .select({ code: itemBarcodes.code, itemId: itemBarcodes.itemId })
      .from(itemBarcodes)
      .where(inArray(itemBarcodes.code, codes.map((c) => c.code)));
    const clash = taken.find((t) => t.itemId !== id);
    if (clash) throw domainError('VALIDATION_FAILED', `Barcode ${clash.code} gehört schon zu einem anderen Artikel`);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(items)
      .set({
        nameDe: update.nameDe.trim(),
        nameVi: update.nameVi?.trim() || null,
        storageArea: update.storageArea,
        stockUnit: update.stockUnit.trim() || 'Stk',
        isFresh: update.isFresh,
        isKeyItem: update.isKeyItem,
        active: update.active,
      })
      .where(eq(items.id, id));
    await tx.delete(itemBarcodes).where(eq(itemBarcodes.itemId, id));
    if (codes.length > 0) {
      await tx.insert(itemBarcodes).values(codes.map((c) => ({ code: c.code, itemId: id, unitsPerScan: String(c.unitsPerScan) })));
    }
    for (const offer of update.offers) {
      await tx
        .update(supplierItems)
        .set({ priceCents: offer.priceCents, orderUnit: offer.orderUnit.trim(), supplierSku: offer.supplierSku?.trim() || null })
        .where(and(eq(supplierItems.id, offer.supplierItemId), eq(supplierItems.itemId, id)));
    }
  });
  await audit(db, p.userId, 'item.update', 'item', id, { barcodes: codes.map((c) => c.code) });
}

export interface SupplierUpdate {
  name: string;
  orderEmail: string;
  ccEmail: string | null;
  phone: string | null;
  orderChannel: 'EMAIL' | 'WHATSAPP' | 'PORTAL';
  deliveryDays: string;
  cutoffNote: string | null;
  minOrderCents: number;
  customerNumber: string | null;
  notes: string | null;
  active: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateSupplier(db: AppDatabase, p: Principal, id: string, update: SupplierUpdate): Promise<void> {
  requireAdmin(p);
  if (!update.name.trim()) throw domainError('VALIDATION_FAILED', 'Name fehlt');
  if (!EMAIL_RE.test(update.orderEmail.trim())) throw domainError('VALIDATION_FAILED', 'Bestell-E-Mail ist ungültig');
  if (update.ccEmail && !EMAIL_RE.test(update.ccEmail.trim())) throw domainError('VALIDATION_FAILED', 'CC-E-Mail ist ungültig');
  await db
    .update(suppliers)
    .set({
      ...update,
      name: update.name.trim(),
      orderEmail: update.orderEmail.trim(),
      ccEmail: update.ccEmail?.trim() || null,
    })
    .where(eq(suppliers.id, id));
  await audit(db, p.userId, 'supplier.update', 'supplier', id, {});
}
