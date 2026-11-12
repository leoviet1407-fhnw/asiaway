import { parse } from 'csv-parse/sync';
import { eq } from 'drizzle-orm';
import { isValidGtin, normalizeCode } from '../../domain/ean';
import { parseChfToCents, parseQty } from '../../domain/qty';
import type { AppDatabase } from '../db/client';
import { itemBarcodes, items, supplierItems, suppliers } from '../db/schema';

/**
 * Import of the real item / price lists.
 *
 * One CSV row per supplier item:
 *   sku, name_de, name_vi, storage_area, stock_unit, fresh, key_item,
 *   supplier, supplier_sku, order_unit, pack_size, price_chf, ean
 * `ean` may hold several codes separated by "|"; a code may carry its units
 * per scan after a colon ("7610000000001:0.0833" for one bottle of a 12-case).
 * Separators "," and ";" are both accepted (Excel in Switzerland writes ";").
 *
 * TODO when the real lists arrive: read .xlsx directly (e.g. with exceljs) and
 * map the suppliers' own column names onto these.
 */

export interface ImportRow {
  line: number;
  sku: string;
  nameDe: string;
  nameVi: string | null;
  storageArea: 'COLD' | 'FREEZER' | 'DRY' | 'BAR';
  stockUnit: string;
  isFresh: boolean;
  isKeyItem: boolean;
  supplier: string;
  supplierSku: string | null;
  orderUnit: string;
  packSize: number;
  priceCents: number;
  barcodes: { code: string; unitsPerScan: number }[];
}

export interface ParseResult {
  rows: ImportRow[];
  errors: string[];
}

const AREA: Record<string, ImportRow['storageArea']> = {
  cold: 'COLD', kuehlraum: 'COLD', kühlraum: 'COLD', kuehl: 'COLD', kühl: 'COLD',
  freezer: 'FREEZER', tiefkuehler: 'FREEZER', tiefkühler: 'FREEZER', tk: 'FREEZER',
  dry: 'DRY', trockenlager: 'DRY', trocken: 'DRY',
  bar: 'BAR', getraenke: 'BAR', getränke: 'BAR',
};

const yes = (v: string | undefined) => /^(1|ja|yes|true|x)$/i.test((v ?? '').trim());

export function parseItemsCsv(text: string): ParseResult {
  const delimiter = (text.split('\n')[0] ?? '').includes(';') ? ';' : ',';
  const records = parse(text, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true, delimiter }) as Record<string, string>[];
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  records.forEach((r, i) => {
    const line = i + 2;
    const problems: string[] = [];
    const sku = r.sku ?? '';
    if (!sku) problems.push('sku fehlt');
    if (!r.name_de) problems.push('name_de fehlt');
    if (!r.supplier) problems.push('supplier fehlt');
    if (!r.order_unit) problems.push('order_unit fehlt');
    const area = AREA[(r.storage_area ?? 'dry').toLowerCase()];
    if (!area) problems.push(`storage_area "${r.storage_area}" unbekannt`);
    const pack = parseQty(r.pack_size || '1');
    if (!pack) problems.push('pack_size ungültig');
    const price = parseChfToCents(r.price_chf ?? '');
    if (price === null) problems.push('price_chf ungültig');
    const barcodes: ImportRow['barcodes'] = [];
    for (const part of (r.ean ?? '').split('|').map((s) => s.trim()).filter(Boolean)) {
      const [rawCode, rawUnits] = part.split(':');
      const code = normalizeCode(rawCode ?? '');
      if (/^\d+$/.test(code) && !isValidGtin(code)) problems.push(`EAN ${code} hat eine falsche Prüfziffer`);
      const units = rawUnits ? parseQty(rawUnits) : 1;
      if (!units) problems.push(`Menge pro Scan bei ${code} ungültig`);
      barcodes.push({ code, unitsPerScan: units ?? 1 });
    }
    if (problems.length > 0) {
      errors.push(`Zeile ${line} (${sku || '?'}): ${problems.join(', ')}`);
      return;
    }
    rows.push({
      line,
      sku,
      nameDe: r.name_de!,
      nameVi: r.name_vi || null,
      storageArea: area!,
      stockUnit: r.stock_unit || 'Stk',
      isFresh: yes(r.fresh),
      isKeyItem: yes(r.key_item),
      supplier: r.supplier!,
      supplierSku: r.supplier_sku || null,
      orderUnit: r.order_unit!,
      packSize: pack!,
      priceCents: price!,
      barcodes,
    });
  });
  const seen = new Map<string, number>();
  for (const row of rows) {
    for (const b of row.barcodes) {
      const other = seen.get(b.code);
      if (other !== undefined && rows[other]!.sku !== row.sku) errors.push(`Zeile ${row.line}: EAN ${b.code} gehört auch zu Zeile ${rows[other]!.line}`);
      seen.set(b.code, rows.indexOf(row));
    }
  }
  return { rows, errors };
}

export interface ImportPlan {
  newSuppliers: string[];
  newItems: string[];
  updatedItems: string[];
}

/** Upserts by item sku and supplier name. Suppliers created here get a placeholder email to fill in. */
export async function applyItemsImport(db: AppDatabase, rows: ImportRow[], { dryRun }: { dryRun: boolean }): Promise<ImportPlan> {
  const plan: ImportPlan = { newSuppliers: [], newItems: [], updatedItems: [] };
  const supplierIds = new Map((await db.select().from(suppliers)).map((s) => [s.name, s.id]));
  const itemIds = new Map((await db.select().from(items)).map((i) => [i.sku, i.id]));

  for (const row of rows) {
    if (!supplierIds.has(row.supplier) && !plan.newSuppliers.includes(row.supplier)) plan.newSuppliers.push(row.supplier);
    if (itemIds.has(row.sku)) {
      if (!plan.updatedItems.includes(row.sku)) plan.updatedItems.push(row.sku);
    } else if (!plan.newItems.includes(row.sku)) plan.newItems.push(row.sku);
  }
  if (dryRun) return plan;

  await db.transaction(async (tx) => {
    for (const name of plan.newSuppliers) {
      const [s] = await tx.insert(suppliers).values({ name, orderEmail: 'bitte-eintragen@asiaway.ch', notes: 'Per Import angelegt – Bestell-E-Mail prüfen!' }).returning({ id: suppliers.id });
      supplierIds.set(name, s!.id);
    }
    for (const row of rows) {
      const values = { nameDe: row.nameDe, nameVi: row.nameVi, storageArea: row.storageArea, stockUnit: row.stockUnit, isFresh: row.isFresh, isKeyItem: row.isKeyItem, active: true };
      let itemId = itemIds.get(row.sku);
      if (itemId) await tx.update(items).set(values).where(eq(items.id, itemId));
      else {
        const [it] = await tx.insert(items).values({ sku: row.sku, ...values }).returning({ id: items.id });
        itemId = it!.id;
        itemIds.set(row.sku, itemId);
      }
      const offer = { supplierSku: row.supplierSku, orderUnit: row.orderUnit, packSize: String(row.packSize), priceCents: row.priceCents, active: true };
      await tx
        .insert(supplierItems)
        .values({ supplierId: supplierIds.get(row.supplier)!, itemId, ...offer })
        .onConflictDoUpdate({ target: [supplierItems.supplierId, supplierItems.itemId], set: offer });
      for (const b of row.barcodes) {
        await tx
          .insert(itemBarcodes)
          .values({ code: b.code, itemId, unitsPerScan: String(b.unitsPerScan) })
          .onConflictDoUpdate({ target: itemBarcodes.code, set: { itemId, unitsPerScan: String(b.unitsPerScan) } });
      }
    }
  });
  return plan;
}
