import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { assertTransition, canReceiveOrder, type OrderStatus } from '../../domain/order';
import { roundQty } from '../../domain/qty';
import {
  computeDiscrepancies,
  orderStatusAfterReceipt,
  summarize,
  type DiscrepancyRow,
  type DiscrepancySummary,
} from '../../domain/receiving';
import { canAccessLocation, isOrderer, type Principal } from '../../domain/roles';
import { normalizeCode } from '../../domain/ean';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import {
  itemBarcodes,
  items,
  locations,
  purchaseOrders,
  receiptLines,
  receiptPhotos,
  receipts,
  suppliers,
  users,
} from '../db/schema';
import { getOrderLines } from './order-service';

const RECEIVABLE: OrderStatus[] = ['SENT', 'PARTIALLY_RECEIVED'];

export async function listReceivable(db: AppDatabase, p: Principal) {
  const rows = await db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      locationId: purchaseOrders.locationId,
      locationName: locations.name,
      supplierName: suppliers.name,
      deliveryDate: purchaseOrders.deliveryDate,
      sentAt: purchaseOrders.sentAt,
    })
    .from(purchaseOrders)
    .innerJoin(locations, eq(locations.id, purchaseOrders.locationId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(inArray(purchaseOrders.status, RECEIVABLE))
    .orderBy(asc(purchaseOrders.deliveryDate), asc(purchaseOrders.number));
  const open = await db
    .select({ id: receipts.id, orderId: receipts.orderId })
    .from(receipts)
    .where(eq(receipts.status, 'OPEN'));
  return rows
    .filter((r) => canAccessLocation(p, r.locationId))
    .map((r) => ({ ...r, status: r.status as OrderStatus, openReceiptId: open.find((o) => o.orderId === r.id)?.id ?? null }));
}

async function loadOrder(db: AppDatabase, orderId: string) {
  const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).limit(1);
  if (!order) throw domainError('NOT_FOUND', 'Order not found');
  return { ...order, status: order.status as OrderStatus };
}

/** Starts the receipt for a delivery, or resumes the one already open. */
export async function startReceipt(db: AppDatabase, p: Principal, orderId: string): Promise<{ id: string; created: boolean }> {
  const order = await loadOrder(db, orderId);
  if (!canReceiveOrder(p, order)) {
    if (!canAccessLocation(p, order.locationId)) throw domainError('FORBIDDEN', 'Not your location');
    throw domainError('ILLEGAL_TRANSITION', `Order is ${order.status}; it cannot be received`);
  }
  const findOpen = async () => {
    const [row] = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.orderId, orderId), eq(receipts.status, 'OPEN')))
      .limit(1);
    return row?.id ?? null;
  };
  const existing = await findOpen();
  if (existing) return { id: existing, created: false };
  try {
    const [row] = await db.insert(receipts).values({ orderId, startedBy: p.userId }).returning({ id: receipts.id });
    await audit(db, p.userId, 'receipt.start', 'receipt', row!.id, { orderId });
    return { id: row!.id, created: true };
  } catch (error) {
    const raced = await findOpen();
    if (raced) return { id: raced, created: false };
    throw error;
  }
}

async function loadReceipt(db: AppDatabase, p: Principal, receiptId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(receiptId)) throw domainError('NOT_FOUND', 'Receipt not found');
  const [receipt] = await db.select().from(receipts).where(eq(receipts.id, receiptId)).limit(1);
  if (!receipt) throw domainError('NOT_FOUND', 'Receipt not found');
  const order = await loadOrder(db, receipt.orderId);
  if (!canAccessLocation(p, order.locationId) && !isOrderer(p)) throw domainError('FORBIDDEN', 'Not your location');
  return { receipt, order };
}

/** Quantities received per item in the order's OTHER completed receipts (earlier deliveries). */
async function receivedBefore(db: AppDatabase, orderId: string, excludeReceiptId: string, until: Date | null) {
  const rows = await db
    .select({ itemId: receiptLines.itemId, qty: receiptLines.qty, completedAt: receipts.completedAt })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(and(eq(receipts.orderId, orderId), eq(receipts.status, 'COMPLETED'), ne(receipts.id, excludeReceiptId)));
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.itemId) continue;
    if (until && row.completedAt && row.completedAt > until) continue;
    map.set(row.itemId, roundQty((map.get(row.itemId) ?? 0) + Number(row.qty)));
  }
  return map;
}

export interface ReceiptView {
  receipt: { id: string; status: 'OPEN' | 'COMPLETED'; startedAt: Date; completedAt: Date | null; closedOrder: boolean; note: string | null };
  order: { id: string; number: string; status: OrderStatus; deliveryDate: string | null; locationName: string; supplierName: string };
  startedBy: string | null;
  completedBy: string | null;
  /** Ordered lines with what is still expected before this delivery. */
  lines: {
    itemId: string;
    nameDe: string;
    nameVi: string | null;
    storageArea: string;
    isFresh: boolean;
    orderUnit: string;
    ordered: number;
    before: number;
    expectedNow: number;
    barcodes: string[];
  }[];
  /** This delivery's quantities so far. */
  current: { itemId: string | null; scannedCode: string | null; qty: number; damaged: boolean; note: string | null }[];
  /** Every known barcode, for items that come but were not ordered. */
  barcodes: { code: string; itemId: string; unitsPerScan: number }[];
  itemNames: Record<string, { nameDe: string; stockUnit: string }>;
  photos: { id: string; kind: 'DELIVERY_NOTE' | 'DAMAGE'; createdAt: Date }[];
  rows: DiscrepancyRow[];
  summary: DiscrepancySummary;
}

export async function getReceiptView(db: AppDatabase, p: Principal, receiptId: string): Promise<ReceiptView> {
  const { receipt, order } = await loadReceipt(db, p, receiptId);
  const [location] = await db.select().from(locations).where(eq(locations.id, order.locationId));
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
  const orderLines = await getOrderLines(db, order.id);
  const before = await receivedBefore(db, order.id, receipt.id, receipt.completedAt);
  const current = (await db.select().from(receiptLines).where(eq(receiptLines.receiptId, receipt.id))).map((l) => ({
    itemId: l.itemId,
    scannedCode: l.scannedCode,
    qty: Number(l.qty),
    damaged: l.damaged,
    note: l.note,
  }));
  const allCodes = (await db.select().from(itemBarcodes)).map((b) => ({ code: b.code, itemId: b.itemId, unitsPerScan: Number(b.unitsPerScan) }));
  const allItems = await db.select({ id: items.id, nameDe: items.nameDe, stockUnit: items.stockUnit }).from(items);
  const photos = await db
    .select({ id: receiptPhotos.id, kind: receiptPhotos.kind, createdAt: receiptPhotos.createdAt })
    .from(receiptPhotos)
    .where(eq(receiptPhotos.receiptId, receipt.id))
    .orderBy(asc(receiptPhotos.createdAt));
  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [receipt.startedBy, receipt.completedBy].filter((x): x is string => Boolean(x))));

  const rows = computeDiscrepancies(
    orderLines.map((l) => ({ itemId: l.itemId, qty: l.qty, isFresh: l.isFresh })),
    before,
    current,
  );
  return {
    receipt: {
      id: receipt.id,
      status: receipt.status as 'OPEN' | 'COMPLETED',
      startedAt: receipt.startedAt,
      completedAt: receipt.completedAt,
      closedOrder: receipt.closedOrder,
      note: receipt.note,
    },
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      deliveryDate: order.deliveryDate,
      locationName: location!.name,
      supplierName: supplier!.name,
    },
    startedBy: people.find((u) => u.id === receipt.startedBy)?.name ?? null,
    completedBy: people.find((u) => u.id === receipt.completedBy)?.name ?? null,
    lines: orderLines.map((l) => {
      const b = before.get(l.itemId) ?? 0;
      return {
        itemId: l.itemId,
        nameDe: l.nameDe,
        nameVi: l.nameVi,
        storageArea: l.storageArea,
        isFresh: l.isFresh,
        orderUnit: l.orderUnit,
        ordered: l.qty,
        before: b,
        expectedNow: roundQty(Math.max(0, l.qty - b)),
        barcodes: allCodes.filter((c) => c.itemId === l.itemId).map((c) => c.code),
      };
    }),
    current,
    barcodes: allCodes,
    itemNames: Object.fromEntries(allItems.map((i) => [i.id, { nameDe: i.nameDe, stockUnit: i.stockUnit }])),
    photos: photos.map((ph) => ({ ...ph, kind: ph.kind as 'DELIVERY_NOTE' | 'DAMAGE' })),
    rows,
    summary: summarize(rows),
  };
}

export interface SyncLine {
  itemId: string | null;
  scannedCode: string | null;
  qty: number;
  damaged: boolean;
  note: string | null;
}

/**
 * Stores this delivery's quantities. Values are ABSOLUTE ("12 received"), not
 * increments, so the phone can resend after a dropped connection without ever
 * counting twice. Lines not mentioned are left alone; qty 0 without damage
 * removes a line.
 */
export async function syncReceiptLines(db: AppDatabase, p: Principal, receiptId: string, lines: SyncLine[]): Promise<void> {
  const { receipt } = await loadReceipt(db, p, receiptId);
  if (receipt.status !== 'OPEN') throw domainError('RECEIPT_CLOSED', 'This delivery has already been closed');
  if (lines.length > 500) throw domainError('VALIDATION_FAILED', 'Too many lines');

  const knownItems = new Set((await db.select({ id: items.id }).from(items)).map((i) => i.id));
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const raw of lines) {
      const qty = roundQty(raw.qty);
      if (!Number.isFinite(qty) || qty < 0 || qty > 100_000) throw domainError('VALIDATION_FAILED', 'Invalid quantity');
      const note = raw.note?.trim().slice(0, 500) || null;
      if (raw.itemId) {
        if (!knownItems.has(raw.itemId)) throw domainError('VALIDATION_FAILED', 'Unknown item');
        const where = and(eq(receiptLines.receiptId, receiptId), eq(receiptLines.itemId, raw.itemId));
        if (qty === 0 && !raw.damaged && !note) {
          await tx.delete(receiptLines).where(where);
          continue;
        }
        const [existing] = await tx.select({ id: receiptLines.id }).from(receiptLines).where(where).limit(1);
        if (existing) {
          await tx.update(receiptLines).set({ qty: String(qty), damaged: raw.damaged, note, updatedBy: p.userId, updatedAt: now }).where(eq(receiptLines.id, existing.id));
        } else {
          await tx.insert(receiptLines).values({ receiptId, itemId: raw.itemId, qty: String(qty), damaged: raw.damaged, note, updatedBy: p.userId, updatedAt: now });
        }
      } else {
        const code = normalizeCode(raw.scannedCode ?? '');
        if (!code || code.length > 64) throw domainError('VALIDATION_FAILED', 'Missing code');
        const [existing] = await tx
          .select({ id: receiptLines.id })
          .from(receiptLines)
          .where(and(eq(receiptLines.receiptId, receiptId), eq(receiptLines.scannedCode, code)))
          .limit(1);
        if (qty === 0 && !raw.damaged && !note) {
          if (existing) await tx.delete(receiptLines).where(eq(receiptLines.id, existing.id));
          continue;
        }
        if (existing) {
          await tx.update(receiptLines).set({ qty: String(qty), damaged: raw.damaged, note, updatedBy: p.userId, updatedAt: now }).where(eq(receiptLines.id, existing.id));
        } else {
          await tx.insert(receiptLines).values({ receiptId, itemId: null, scannedCode: code, qty: String(qty), damaged: raw.damaged, note, updatedBy: p.userId, updatedAt: now });
        }
      }
    }
  });
}

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export async function addReceiptPhoto(
  db: AppDatabase,
  p: Principal,
  receiptId: string,
  kind: 'DELIVERY_NOTE' | 'DAMAGE',
  mime: string,
  data: Buffer,
): Promise<string> {
  const { receipt } = await loadReceipt(db, p, receiptId);
  if (receipt.status !== 'OPEN') throw domainError('RECEIPT_CLOSED', 'This delivery has already been closed');
  if (!PHOTO_TYPES.has(mime)) throw domainError('VALIDATION_FAILED', 'Only JPEG, PNG or WebP photos');
  if (data.length === 0 || data.length > MAX_PHOTO_BYTES) throw domainError('VALIDATION_FAILED', 'Photo is empty or too large');
  const [row] = await db.insert(receiptPhotos).values({ receiptId, kind, mime, data, createdBy: p.userId }).returning({ id: receiptPhotos.id });
  await audit(db, p.userId, 'receipt.photo', 'receipt', receiptId, { kind, bytes: data.length });
  return row!.id;
}

export async function getReceiptPhoto(db: AppDatabase, p: Principal, photoId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(photoId)) throw domainError('NOT_FOUND', 'Photo not found');
  const [photo] = await db.select().from(receiptPhotos).where(eq(receiptPhotos.id, photoId)).limit(1);
  if (!photo) throw domainError('NOT_FOUND', 'Photo not found');
  await loadReceipt(db, p, photo.receiptId);
  return photo;
}

/**
 * Books the delivery. "Rest kommt noch" (closeOrder=false) keeps an incomplete
 * order open for the next delivery; "Abschliessen" (closeOrder=true) ends it.
 */
export async function completeReceipt(
  db: AppDatabase,
  p: Principal,
  receiptId: string,
  { closeOrder, note }: { closeOrder: boolean; note?: string | null },
  now = new Date(),
): Promise<{ orderStatus: OrderStatus; summary: DiscrepancySummary }> {
  const view = await getReceiptView(db, p, receiptId);
  if (view.receipt.status !== 'OPEN') throw domainError('RECEIPT_CLOSED', 'This delivery has already been closed');
  const order = await loadOrder(db, view.order.id);
  if (!canReceiveOrder(p, order)) throw domainError('FORBIDDEN', 'Not allowed to receive this order');

  const next = orderStatusAfterReceipt(view.rows, closeOrder);
  assertTransition(order.status, next);

  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(receipts).where(eq(receipts.id, receiptId)).for('update');
    if (!locked || locked.status !== 'OPEN') throw domainError('RECEIPT_CLOSED', 'This delivery has already been closed');
    await tx
      .update(receipts)
      .set({ status: 'COMPLETED', completedBy: p.userId, completedAt: now, closedOrder: next === 'RECEIVED', note: note?.trim() || null })
      .where(eq(receipts.id, receiptId));
    await tx
      .update(purchaseOrders)
      .set({ status: next, updatedAt: now, ...(next === 'RECEIVED' ? { closedAt: now } : {}) })
      .where(eq(purchaseOrders.id, order.id));
    await audit(tx, p.userId, 'receipt.complete', 'receipt', receiptId, {
      orderId: order.id,
      orderStatus: next,
      counts: view.summary.counts,
      damaged: view.summary.damaged,
    });
  });
  return { orderStatus: next, summary: view.summary };
}

/** Completed receipts of an order, newest first (for the order page). */
export async function listReceiptsForOrder(db: AppDatabase, orderId: string) {
  return db
    .select({ id: receipts.id, status: receipts.status, startedAt: receipts.startedAt, completedAt: receipts.completedAt, closedOrder: receipts.closedOrder })
    .from(receipts)
    .where(eq(receipts.orderId, orderId))
    .orderBy(desc(receipts.startedAt));
}
