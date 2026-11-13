import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import {
  assertTransition,
  canCancelOrder,
  canEditOrder,
  canSendOrder,
  canSubmitOrder,
  formatOrderNumber,
  orderTotalCents,
  type OrderStatus,
} from '../../domain/order';
import { roundQty } from '../../domain/qty';
import { canAccessLocation, isOrderer, type Principal } from '../../domain/roles';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import {
  emailLog,
  items,
  locations,
  purchaseOrderLines,
  purchaseOrders,
  supplierItems,
  suppliers,
  users,
} from '../db/schema';
import type { Mailer } from '../mail/mailer';
import { orderEmailText, orderPdfFilename, orderSubject, type OrderDocument } from '../mail/order-document';
import { renderOrderPdf } from '../pdf/order-pdf';

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  locationId: string;
  locationName: string;
  supplierId: string;
  supplierName: string;
  deliveryDate: string | null;
  lineCount: number;
  totalCents: number;
  createdAt: Date;
  sentAt: Date | null;
}

function canSeeOrder(p: Principal, order: { locationId: string }): boolean {
  return isOrderer(p) || canAccessLocation(p, order.locationId);
}

export async function listOrders(
  db: AppDatabase,
  p: Principal,
  filter: { statuses?: OrderStatus[]; locationId?: string } = {},
): Promise<OrderSummary[]> {
  const conditions = [];
  if (filter.statuses && filter.statuses.length > 0) conditions.push(inArray(purchaseOrders.status, filter.statuses));
  if (filter.locationId) conditions.push(eq(purchaseOrders.locationId, filter.locationId));
  const rows = await db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      locationId: purchaseOrders.locationId,
      locationName: locations.name,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      deliveryDate: purchaseOrders.deliveryDate,
      createdAt: purchaseOrders.createdAt,
      sentAt: purchaseOrders.sentAt,
      lineCount: sql<number>`(select count(*)::int from purchase_order_lines l where l.order_id = ${purchaseOrders.id})`,
      totalCents: sql<number>`(select coalesce(round(sum(l.qty * l.unit_price_cents)), 0)::int from purchase_order_lines l where l.order_id = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(locations, eq(locations.id, purchaseOrders.locationId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(purchaseOrders.createdAt));
  return rows
    .filter((r) => canSeeOrder(p, r))
    .map((r) => ({ ...r, status: r.status as OrderStatus, lineCount: Number(r.lineCount), totalCents: Number(r.totalCents) }));
}

export interface OrderLineView {
  id: string;
  itemId: string;
  sku: string;
  nameDe: string;
  nameVi: string | null;
  storageArea: string;
  isFresh: boolean;
  qty: number;
  orderUnit: string;
  quantityUnit: string | null;
  department: string | null;
  itemGroup: string | null;
  unitPriceCents: number;
  supplierSku: string | null;
  note: string | null;
}

async function loadOrderRow(db: AppDatabase, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw domainError('NOT_FOUND', 'Order not found');
  const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1);
  if (!order) throw domainError('NOT_FOUND', 'Order not found');
  return { ...order, status: order.status as OrderStatus };
}

export async function getOrder(db: AppDatabase, p: Principal, id: string) {
  const order = await loadOrderRow(db, id);
  if (!canSeeOrder(p, order)) throw domainError('FORBIDDEN', 'Not your location');
  const [location] = await db.select().from(locations).where(eq(locations.id, order.locationId));
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, order.supplierId));
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, [order.createdBy, order.submittedBy, order.sentBy].filter((x): x is string => Boolean(x))));
  const person = (uid: string | null) => people.find((u) => u.id === uid) ?? null;
  const lines = await getOrderLines(db, id);
  return {
    order,
    location: location!,
    supplier: supplier!,
    lines,
    totalCents: orderTotalCents(lines),
    createdBy: person(order.createdBy),
    submittedBy: person(order.submittedBy),
    sentBy: person(order.sentBy),
  };
}

export async function getOrderLines(db: AppDatabase, orderId: string): Promise<OrderLineView[]> {
  const rows = await db
    .select({
      id: purchaseOrderLines.id,
      itemId: purchaseOrderLines.itemId,
      sku: items.sku,
      nameDe: items.nameDe,
      nameVi: items.nameVi,
      storageArea: items.storageArea,
      isFresh: items.isFresh,
      qty: purchaseOrderLines.qty,
      orderUnit: purchaseOrderLines.orderUnit,
      quantityUnit: purchaseOrderLines.quantityUnit,
      department: items.department,
      itemGroup: items.itemGroup,
      unitPriceCents: purchaseOrderLines.unitPriceCents,
      supplierSku: purchaseOrderLines.supplierSku,
      note: purchaseOrderLines.note,
    })
    .from(purchaseOrderLines)
    .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.orderId, orderId))
    .orderBy(asc(items.storageArea), asc(items.nameDe));
  return rows.map((r) => ({ ...r, qty: Number(r.qty) }));
}

async function nextOrderNumber(db: AppDatabase, now: Date): Promise<string> {
  const result = await db.execute(sql`select nextval('purchase_order_number_seq')::int as n`);
  const rows = (result as unknown as { rows?: { n: number }[] }).rows ?? (result as unknown as { n: number }[]);
  return formatOrderNumber(now.getFullYear(), Number(rows[0]!.n));
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Opens the draft for this location and supplier, creating it if there is none.
 * There is never more than one draft per location and supplier.
 */
export async function openDraft(
  db: AppDatabase,
  p: Principal,
  locationId: string,
  supplierId: string,
  now = new Date(),
): Promise<{ id: string; created: boolean }> {
  if (!canAccessLocation(p, locationId)) throw domainError('FORBIDDEN', 'Not your location');
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!supplier || !supplier.active) throw domainError('NOT_FOUND', 'Supplier not found');
  const [location] = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1);
  if (!location) throw domainError('NOT_FOUND', 'Location not found');

  const existing = async () => {
    const [row] = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.locationId, locationId), eq(purchaseOrders.supplierId, supplierId), eq(purchaseOrders.status, 'DRAFT')))
      .limit(1);
    return row?.id ?? null;
  };
  const found = await existing();
  if (found) return { id: found, created: false };

  try {
    const [row] = await db
      .insert(purchaseOrders)
      .values({ number: await nextOrderNumber(db, now), locationId, supplierId, createdBy: p.userId, createdAt: now, updatedAt: now })
      .returning({ id: purchaseOrders.id });
    await audit(db, p.userId, 'order.create', 'purchase_order', row!.id, { locationId, supplierId });
    return { id: row!.id, created: true };
  } catch (error) {
    // Someone else opened the same draft a moment ago: use theirs.
    if (isUniqueViolation(error)) {
      const raced = await existing();
      if (raced) return { id: raced, created: false };
    }
    throw error;
  }
}

async function editableOrder(db: AppDatabase, p: Principal, orderId: string) {
  const order = await loadOrderRow(db, orderId);
  if (!canEditOrder(p, order)) {
    if (!canSeeOrder(p, order)) throw domainError('FORBIDDEN', 'Not your location');
    throw domainError('ILLEGAL_TRANSITION', `Order is ${order.status} and cannot be edited by you`);
  }
  return order;
}

/** Sets the quantity of one item (0 removes the line). Prices are copied onto the line. */
export async function setLineQty(
  db: AppDatabase,
  p: Principal,
  orderId: string,
  itemId: string,
  qty: number,
  note?: string | null,
): Promise<void> {
  const order = await editableOrder(db, p, orderId);
  if (!Number.isFinite(qty) || qty < 0 || qty > 100_000) throw domainError('VALIDATION_FAILED', 'Invalid quantity');
  const value = roundQty(qty);

  if (value === 0) {
    await db.delete(purchaseOrderLines).where(and(eq(purchaseOrderLines.orderId, orderId), eq(purchaseOrderLines.itemId, itemId)));
  } else {
    const [offer] = await db
      .select()
      .from(supplierItems)
      .where(and(eq(supplierItems.supplierId, order.supplierId), eq(supplierItems.itemId, itemId), eq(supplierItems.active, true)))
      .limit(1);
    if (!offer) throw domainError('ITEM_NOT_FROM_SUPPLIER', 'This supplier does not sell this item');
    const values = {
      orderId,
      itemId,
      supplierItemId: offer.id,
      qty: String(value),
      orderUnit: offer.orderUnit,
      quantityUnit: offer.quantityUnit,
      unitPriceCents: offer.priceCents,
      supplierSku: offer.supplierSku,
      ...(note !== undefined ? { note: note?.trim() || null } : {}),
    };
    await db
      .insert(purchaseOrderLines)
      .values(values)
      .onConflictDoUpdate({
        target: [purchaseOrderLines.orderId, purchaseOrderLines.itemId],
        set: { qty: values.qty, ...(note !== undefined ? { note: values.note } : {}) },
      });
  }
  await db.update(purchaseOrders).set({ updatedAt: new Date() }).where(eq(purchaseOrders.id, orderId));
}

export async function updateOrderDetails(
  db: AppDatabase,
  p: Principal,
  orderId: string,
  details: { deliveryDate: string | null; note: string | null },
): Promise<void> {
  await editableOrder(db, p, orderId);
  if (details.deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(details.deliveryDate)) {
    throw domainError('VALIDATION_FAILED', 'Invalid date');
  }
  await db
    .update(purchaseOrders)
    .set({ deliveryDate: details.deliveryDate || null, note: details.note?.trim() || null, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, orderId));
}

/** Copies the quantities of the last sent order for the same location and supplier. */
export async function copyLastOrder(db: AppDatabase, p: Principal, orderId: string): Promise<number> {
  const order = await editableOrder(db, p, orderId);
  const [last] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.locationId, order.locationId),
        eq(purchaseOrders.supplierId, order.supplierId),
        inArray(purchaseOrders.status, ['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED']),
      ),
    )
    .orderBy(desc(purchaseOrders.sentAt))
    .limit(1);
  if (!last) return 0;
  const lines = await getOrderLines(db, last.id);
  let copied = 0;
  for (const line of lines) {
    try {
      await setLineQty(db, p, orderId, line.itemId, line.qty);
      copied += 1;
    } catch (error) {
      // An item the supplier no longer sells is skipped.
      if (!(error instanceof Error && 'code' in error && error.code === 'ITEM_NOT_FROM_SUPPLIER')) throw error;
    }
  }
  return copied;
}

async function lineCount(db: AppDatabase, orderId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, orderId));
  return Number(row?.n ?? 0);
}

export async function submitOrder(db: AppDatabase, p: Principal, orderId: string, now = new Date()): Promise<void> {
  const order = await loadOrderRow(db, orderId);
  if (!canSubmitOrder(p, order)) {
    assertTransition(order.status, 'SUBMITTED');
    throw domainError('FORBIDDEN', 'Not your location');
  }
  if ((await lineCount(db, orderId)) === 0) throw domainError('EMPTY_ORDER', 'The order has no lines');
  await db
    .update(purchaseOrders)
    .set({ status: 'SUBMITTED', submittedBy: p.userId, submittedAt: now, updatedAt: now })
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.status, 'DRAFT')));
  await audit(db, p.userId, 'order.submit', 'purchase_order', orderId);
}

/** The orderer sends a submitted order back so staff can change it. */
export async function returnToDraft(db: AppDatabase, p: Principal, orderId: string): Promise<void> {
  const order = await loadOrderRow(db, orderId);
  if (!isOrderer(p)) throw domainError('FORBIDDEN', 'Orderers only');
  assertTransition(order.status, 'DRAFT');
  try {
    await db
      .update(purchaseOrders)
      .set({ status: 'DRAFT', submittedBy: null, submittedAt: null, updatedAt: new Date() })
      .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.status, 'SUBMITTED')));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw domainError('VALIDATION_FAILED', 'There is already a newer draft for this supplier and location');
    }
    throw error;
  }
  await audit(db, p.userId, 'order.return_to_draft', 'purchase_order', orderId);
}

export async function cancelOrder(db: AppDatabase, p: Principal, orderId: string, now = new Date()): Promise<void> {
  const order = await loadOrderRow(db, orderId);
  if (!canCancelOrder(p, order)) {
    assertTransition(order.status, 'CANCELLED');
    throw domainError('FORBIDDEN', 'Not allowed to cancel');
  }
  await db
    .update(purchaseOrders)
    .set({ status: 'CANCELLED', closedAt: now, updatedAt: now })
    .where(eq(purchaseOrders.id, orderId));
  await audit(db, p.userId, 'order.cancel', 'purchase_order', orderId, { from: order.status });
}

/** Everything the PDF and email show, built from the order as it stands. */
export async function buildOrderDocument(db: AppDatabase, p: Principal, orderId: string, now = new Date()): Promise<OrderDocument> {
  const view = await getOrder(db, p, orderId);
  const sender = view.sentBy ?? { name: p.name, email: p.email };
  return {
    number: view.order.number,
    createdAt: view.order.sentAt ?? now,
    deliveryDate: view.order.deliveryDate,
    note: view.order.note,
    location: { name: view.location.name, address: view.location.address, deliveryNote: view.location.deliveryNote, phone: view.location.phone, contactEmail: view.location.contactEmail },
    supplier: { name: view.supplier.name, customerNumber: view.supplier.customerNumber, orderEmail: view.supplier.orderEmail, ccEmail: recipients(view.supplier).cc },
    orderedBy: { name: sender.name, email: sender.email },
    lines: [...view.lines]
      .sort((a, b) => (a.department ?? '~').localeCompare(b.department ?? '~', 'de') || (a.itemGroup ?? '~').localeCompare(b.itemGroup ?? '~', 'de') || a.nameDe.localeCompare(b.nameDe, 'de'))
      .map((l) => ({ department: l.department, group: l.itemGroup, supplierSku: l.supplierSku, name: l.nameDe, qty: l.qty, quantityUnit: l.quantityUnit, orderUnit: l.orderUnit, note: l.note })),
  };
}

export interface SendPreview {
  to: string;
  cc: string | null;
  replyTo: string;
  subject: string;
  text: string;
}

export function recipients(supplier: { orderEmail: string; ccEmail: string | null }, env: NodeJS.ProcessEnv = process.env) {
  const cc = [supplier.ccEmail, env.ORDER_CC_EMAIL].filter((x): x is string => Boolean(x && x.trim())).join(', ');
  return { to: supplier.orderEmail, cc: cc || null };
}

export async function previewSend(db: AppDatabase, p: Principal, orderId: string): Promise<SendPreview> {
  const view = await getOrder(db, p, orderId);
  const doc = await buildOrderDocument(db, p, orderId);
  const { to, cc } = recipients(view.supplier);
  return { to, cc, replyTo: p.email, subject: orderSubject(doc), text: orderEmailText(doc) };
}

/**
 * Sends a submitted order to the supplier: renders the PDF, emails it, archives
 * it on the order and marks the order SENT — all under a row lock, so an order
 * is emailed at most once even if two people press "Senden" together.
 * If the email fails, nothing changes and the order stays SUBMITTED.
 */
export async function sendOrder(
  db: AppDatabase,
  p: Principal,
  orderId: string,
  mailer: Mailer,
  from: string,
  now = new Date(),
): Promise<{ messageId: string | null }> {
  const pre = await loadOrderRow(db, orderId);
  if (pre.status === 'SENT' || pre.status === 'PARTIALLY_RECEIVED' || pre.status === 'RECEIVED') {
    throw domainError('ALREADY_SENT', 'This order has already been sent');
  }
  if (!canSendOrder(p, pre)) {
    if (!isOrderer(p)) throw domainError('FORBIDDEN', 'Orderers only');
    assertTransition(pre.status, 'SENT');
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for('update');
    if (!locked || locked.status !== 'SUBMITTED') throw domainError('ALREADY_SENT', 'This order has already been sent');
    if ((await lineCount(tx, orderId)) === 0) throw domainError('EMPTY_ORDER', 'The order has no lines');

    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, locked.supplierId));
    const doc = { ...(await buildOrderDocument(tx, p, orderId, now)), createdAt: now, orderedBy: { name: p.name, email: p.email } };
    const pdf = await renderOrderPdf(doc);
    const subject = orderSubject(doc);
    const text = orderEmailText(doc);
    const { to, cc } = recipients(supplier!);

    let result: { messageId: string | null };
    try {
      result = await mailer.send({
        from,
        to,
        cc: cc ?? undefined,
        replyTo: p.email,
        subject,
        text,
        attachments: [{ filename: orderPdfFilename(doc), content: pdf, contentType: 'application/pdf' }],
      });
    } catch (error) {
      console.error('[order] email failed', error);
      throw domainError('MAIL_FAILED', 'The email could not be sent; the order was not sent');
    }

    await tx
      .update(purchaseOrders)
      .set({ status: 'SENT', sentBy: p.userId, sentAt: now, sentTo: to, sentPdf: Buffer.from(pdf), updatedAt: now })
      .where(eq(purchaseOrders.id, orderId));
    await tx.insert(emailLog).values({ orderId, toEmail: to, ccEmail: cc, subject, body: text, transport: mailer.transport, messageId: result.messageId, sentAt: now });
    await audit(tx, p.userId, 'order.send', 'purchase_order', orderId, { to, cc, transport: mailer.transport });
    return result;
  });
}

/** The PDF: the archived one for a sent order, otherwise a fresh preview. */
export async function orderPdf(db: AppDatabase, p: Principal, orderId: string): Promise<{ filename: string; data: Uint8Array }> {
  const { order } = await getOrder(db, p, orderId);
  const doc = await buildOrderDocument(db, p, orderId);
  if (order.sentPdf) return { filename: orderPdfFilename(doc), data: order.sentPdf };
  return { filename: orderPdfFilename(doc).replace('.pdf', '-Vorschau.pdf'), data: await renderOrderPdf(doc) };
}
