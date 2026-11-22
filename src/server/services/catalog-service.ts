import { and, asc, eq, inArray } from 'drizzle-orm';
import { isValidGtin, normalizeCode } from '../../domain/ean';
import { domainError } from '../../domain/errors';
import { isOrderer, isPlanner, isRestaurant, type Principal } from '../../domain/roles';
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
  nameEn: string | null;
  storageArea: StorageArea;
  stockUnit: string;
  isFresh: boolean;
  isKeyItem: boolean;
  department: string | null;
  itemGroup: string | null;
  active: boolean;
  barcodes: { code: string; unitsPerScan: number; label: string | null }[];
  offers: {
    supplierItemId: string;
    supplierId: string;
    supplierName: string;
    supplierSku: string | null;
    orderUnit: string;
    quantityUnit: string | null;
    packSize: number;
    priceCents: number;
    /** false = removed from this item (kept for past orders) */
    active: boolean;
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
      quantityUnit: supplierItems.quantityUnit,
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
      nameEn: i.nameEn,
      storageArea: i.storageArea as StorageArea,
      stockUnit: i.stockUnit,
      isFresh: i.isFresh,
      isKeyItem: i.isKeyItem,
      department: i.department,
      itemGroup: i.itemGroup,
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
          quantityUnit: o.quantityUnit,
          packSize: Number(o.packSize),
          priceCents: o.priceCents,
          active: o.active,
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

/** Products and suppliers are kept by the people who approve orders (orderers) and admins. */
export const canEditCatalog = (p: Principal) => isOrderer(p);
/** Products (names, barcodes, prices) are also kept by the Leitung (planners), e.g. Belle filling in barcodes. */
export const canEditItems = (p: Principal) => isOrderer(p) || isPlanner(p);

function requireItemEditor(p: Principal) {
  if (!canEditItems(p)) throw domainError('FORBIDDEN', 'Nur Leitung, Besteller und Admins');
}

/** Active packaged items (not fresh goods) that are ordered from someone but have no barcode yet. */
export async function itemsWithoutBarcode(db: AppDatabase): Promise<{ id: string; nameDe: string }[]> {
  const all = await listItems(db);
  return all.filter((i) => !i.isFresh && i.offers.length > 0 && i.barcodes.length === 0).map((i) => ({ id: i.id, nameDe: i.nameDe }));
}

function requireAdmin(p: Principal) {
  if (!canEditCatalog(p)) throw domainError('FORBIDDEN', 'Nur Besteller und Admins');
}

/** Cleans and checks barcodes; a code may not belong to another item. */
async function checkBarcodes(db: AppDatabase, barcodes: { code: string; unitsPerScan: number }[], itemId: string | null) {
  const codes = barcodes.map((b) => ({ ...b, code: normalizeCode(b.code) })).filter((b) => b.code);
  for (const b of codes) {
    if (/^\d+$/.test(b.code) && !isValidGtin(b.code)) {
      throw domainError('VALIDATION_FAILED', `Ungültiger Barcode ${b.code} (Prüfziffer)`, { code: b.code });
    }
    if (!(b.unitsPerScan > 0)) throw domainError('VALIDATION_FAILED', 'Menge pro Scan muss > 0 sein');
  }
  if (new Set(codes.map((c) => c.code)).size !== codes.length) throw domainError('VALIDATION_FAILED', 'Ein Barcode ist doppelt eingetragen');
  if (codes.length > 0) {
    const taken = await db
      .select({ code: itemBarcodes.code, itemId: itemBarcodes.itemId })
      .from(itemBarcodes)
      .where(inArray(itemBarcodes.code, codes.map((c) => c.code)));
    const clash = taken.find((t) => t.itemId !== itemId);
    if (clash) throw domainError('VALIDATION_FAILED', `Barcode ${clash.code} gehört schon zu einem anderen Artikel`);
  }
  return codes;
}

/** A supplier offer for an item: who sells it, in which unit, at what price. */
export interface NewOffer {
  supplierId: string;
  supplierSku: string | null;
  orderUnit: string;
  quantityUnit: string | null;
  packSize: number;
  priceCents: number;
}

async function checkOffer(db: AppDatabase, offer: NewOffer) {
  const [s] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, offer.supplierId));
  if (!s) throw domainError('VALIDATION_FAILED', 'Lieferant fehlt');
  if (!offer.orderUnit.trim()) throw domainError('VALIDATION_FAILED', 'Bestelleinheit fehlt');
  if (!(offer.packSize > 0)) throw domainError('VALIDATION_FAILED', 'Packungsgrösse muss > 0 sein');
  if (!(offer.priceCents >= 0)) throw domainError('VALIDATION_FAILED', 'Preis ist ungültig');
}

const offerValues = (o: NewOffer) => ({
  supplierSku: o.supplierSku?.trim() || null,
  orderUnit: o.orderUnit.trim(),
  quantityUnit: o.quantityUnit?.trim() || null,
  packSize: String(o.packSize),
  priceCents: o.priceCents,
  active: true,
});

/** Next free internal number "N-1001", "N-1002", … for items made in the app. */
async function nextSku(db: AppDatabase): Promise<string> {
  const rows = await db.select({ sku: items.sku }).from(items);
  const max = rows.reduce((m, r) => {
    const n = /^N-(\d+)$/.exec(r.sku);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 1000);
  return `N-${max + 1}`;
}

export interface ItemCreate extends Omit<ItemUpdate, 'offers' | 'active'> {
  /** Optional own number; empty = the next "N-…" number. */
  sku: string | null;
  offer: NewOffer;
}

/** A new product with its first supplier. Returns the new item's id. */
export async function createItem(db: AppDatabase, p: Principal, input: ItemCreate): Promise<string> {
  requireItemEditor(p);
  if (!input.nameDe.trim()) throw domainError('VALIDATION_FAILED', 'Name fehlt');
  const sku = input.sku?.trim() || (await nextSku(db));
  const [dup] = await db.select({ id: items.id }).from(items).where(eq(items.sku, sku));
  if (dup) throw domainError('VALIDATION_FAILED', `Art.-Nr. ${sku} gibt es schon`);
  const codes = await checkBarcodes(db, input.barcodes, null);
  await checkOffer(db, input.offer);
  const id = await db.transaction(async (tx) => {
    const [it] = await tx
      .insert(items)
      .values({
        sku,
        nameDe: input.nameDe.trim(),
        nameVi: input.nameVi?.trim() || null,
        nameEn: input.nameEn?.trim() || null,
        storageArea: input.storageArea,
        stockUnit: input.stockUnit.trim() || 'Stk',
        isFresh: input.isFresh,
        isKeyItem: input.isKeyItem,
        department: input.department?.trim() || null,
        itemGroup: input.itemGroup?.trim() || null,
        active: true,
      })
      .returning({ id: items.id });
    const itemId = it!.id;
    if (codes.length > 0) await tx.insert(itemBarcodes).values(codes.map((c) => ({ code: c.code, itemId, unitsPerScan: String(c.unitsPerScan) })));
    await tx.insert(supplierItems).values({ supplierId: input.offer.supplierId, itemId, ...offerValues(input.offer) });
    return itemId;
  });
  await audit(db, p.userId, 'item.create', 'item', id, { sku, supplierId: input.offer.supplierId });
  return id;
}

export interface ItemUpdate {
  nameDe: string;
  nameVi: string | null;
  nameEn: string | null;
  storageArea: StorageArea;
  stockUnit: string;
  isFresh: boolean;
  isKeyItem: boolean;
  department: string | null;
  itemGroup: string | null;
  active: boolean;
  /** Codes with their units per scan; replaces the item's barcodes. */
  barcodes: { code: string; unitsPerScan: number }[];
  /** Price per order unit for each existing offer. */
  offers: { supplierItemId: string; priceCents: number; orderUnit: string; quantityUnit: string | null; supplierSku: string | null }[];
  /** Offers to take off this item (the supplier no longer sells it). */
  removeOfferIds?: string[];
  /** Another supplier for this item. */
  newOffer?: NewOffer | null;
}

export async function updateItem(db: AppDatabase, p: Principal, id: string, update: ItemUpdate): Promise<void> {
  requireItemEditor(p);
  if (!update.nameDe.trim()) throw domainError('VALIDATION_FAILED', 'Name fehlt');
  const codes = await checkBarcodes(db, update.barcodes, id);
  const remove = new Set(update.removeOfferIds ?? []);
  if (update.newOffer) await checkOffer(db, update.newOffer);
  const current = await db.select().from(supplierItems).where(eq(supplierItems.itemId, id));
  const staying = current.filter((o) => o.active && !remove.has(o.id));
  if (update.active && staying.length === 0 && !update.newOffer) throw domainError('VALIDATION_FAILED', 'Ein aktiver Artikel braucht mindestens einen Lieferanten');

  await db.transaction(async (tx) => {
    await tx
      .update(items)
      .set({
        nameDe: update.nameDe.trim(),
        nameVi: update.nameVi?.trim() || null,
        nameEn: update.nameEn?.trim() || null,
        storageArea: update.storageArea,
        stockUnit: update.stockUnit.trim() || 'Stk',
        isFresh: update.isFresh,
        isKeyItem: update.isKeyItem,
        department: update.department?.trim() || null,
        itemGroup: update.itemGroup?.trim() || null,
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
        .set({ priceCents: offer.priceCents, orderUnit: offer.orderUnit.trim(), quantityUnit: offer.quantityUnit?.trim() || null, supplierSku: offer.supplierSku?.trim() || null })
        .where(and(eq(supplierItems.id, offer.supplierItemId), eq(supplierItems.itemId, id)));
    }
    // Removed offers are switched off, not deleted: past orders still point at them
    for (const offerId of remove) {
      await tx.update(supplierItems).set({ active: false }).where(and(eq(supplierItems.id, offerId), eq(supplierItems.itemId, id)));
    }
    if (update.newOffer) {
      const values = offerValues(update.newOffer);
      await tx
        .insert(supplierItems)
        .values({ supplierId: update.newOffer.supplierId, itemId: id, ...values })
        .onConflictDoUpdate({ target: [supplierItems.supplierId, supplierItems.itemId], set: values });
    }
  });
  await audit(db, p.userId, 'item.update', 'item', id, { barcodes: codes.map((c) => c.code), removed: [...remove], added: update.newOffer?.supplierId ?? null });
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

/** A new supplier; returns its id. Its products are added under Artikel. */
export async function createSupplier(db: AppDatabase, p: Principal, input: Omit<SupplierUpdate, 'active'>): Promise<string> {
  requireAdmin(p);
  if (!input.name.trim()) throw domainError('VALIDATION_FAILED', 'Name fehlt');
  if (!EMAIL_RE.test(input.orderEmail.trim())) throw domainError('VALIDATION_FAILED', 'Bestell-E-Mail ist ungültig');
  if (input.ccEmail && !EMAIL_RE.test(input.ccEmail.trim())) throw domainError('VALIDATION_FAILED', 'CC-E-Mail ist ungültig');
  const all = await db.select({ name: suppliers.name }).from(suppliers);
  if (all.some((s) => s.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw domainError('VALIDATION_FAILED', 'Diesen Lieferanten gibt es schon');
  const [row] = await db
    .insert(suppliers)
    .values({ ...input, name: input.name.trim(), orderEmail: input.orderEmail.trim(), ccEmail: input.ccEmail?.trim() || null, active: true })
    .returning({ id: suppliers.id });
  await audit(db, p.userId, 'supplier.create', 'supplier', row!.id, { name: input.name.trim() });
  return row!.id;
}
