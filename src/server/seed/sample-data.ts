import { sql } from 'drizzle-orm';
import { makeEan13 } from '../../domain/ean';
import type { Principal } from '../../domain/roles';
import { addDaysIso, todayIso } from '../../lib/dates';
import { hashPassword } from '../auth/password';
import { loadPrincipalForUser } from '../auth/session';
import type { AppDatabase } from '../db/client';
import { itemBarcodes, items, locations, supplierItems, suppliers, userRoles, users } from '../db/schema';
import { MemoryMailer } from '../mail/mailer';
import { openDraft, sendOrder, setLineQty, submitOrder, updateOrderDetails } from '../services/order-service';

/**
 * SAMPLE data for development and demos. Every supplier, price and barcode
 * here is made up; the real lists replace them through `npm run items:import`.
 * Sample EANs use the 20–29 prefix, which GS1 reserves for in-store use, so
 * they can never collide with a real product.
 */

export const LOCATIONS = [
  { id: 'oerlikon', name: 'Oerlikon', shortName: 'OER', address: 'Musterstrasse 1, 8050 Zürich', deliveryNote: 'Anlieferung Hintereingang, Mo–Sa 8–11 Uhr', sort: 1 },
  { id: 'winti-vn', name: 'Winterthur Vietnamesisch', shortName: 'WVN', address: 'Musterweg 2, 8400 Winterthur', deliveryNote: '1. OG – Lift benutzen', sort: 2 },
  { id: 'winti-th', name: 'Winterthur Thai', shortName: 'WTH', address: 'Musterweg 2, 8400 Winterthur', deliveryNote: 'Erdgeschoss, Eingang Thai', sort: 3 },
] as const;

const SUPPLIERS = [
  { key: 'asia', name: 'Muster Asia Food AG', orderEmail: 'bestellung@muster-asiafood.example', phone: '+41 44 000 00 01', deliveryDays: 'Di, Fr', cutoffNote: 'Bestellung bis 2 Tage vorher, 12 Uhr', minOrderCents: 25000, customerNumber: 'K-10457' },
  { key: 'frisch', name: 'Muster Frischmarkt GmbH', orderEmail: 'order@muster-frischmarkt.example', phone: '+41 44 000 00 02', deliveryDays: 'Mo–Sa', cutoffNote: 'Bestellung bis 20 Uhr für den nächsten Morgen', minOrderCents: 10000, customerNumber: 'AW-77' },
  { key: 'handel', name: 'AsiaWay Handel (Muster)', orderEmail: 'handel@asiaway-handel.example', phone: '+41 52 000 00 03', deliveryDays: 'Mi', cutoffNote: 'Bestellung bis Montag', minOrderCents: 0, customerNumber: null },
] as const;

type Area = 'COLD' | 'FREEZER' | 'DRY' | 'BAR';
interface SampleItem {
  sku: string;
  de: string;
  vi: string;
  area: Area;
  unit: string;
  supplier: 'asia' | 'frisch' | 'handel';
  orderUnit: string;
  pack: number;
  price: number; // CHF per order unit
  fresh?: boolean;
  key?: boolean;
  /** Extra barcode on the single piece: [units per scan as fraction of the case] */
  piece?: number;
}

const ITEMS: SampleItem[] = [
  // Asia Food – dry
  { sku: 'A-1001', de: 'Jasminreis 20 kg', vi: 'Gạo thơm 20 kg', area: 'DRY', unit: 'Sack', supplier: 'asia', orderUnit: 'Sack 20 kg', pack: 1, price: 42.5, key: true },
  { sku: 'A-1002', de: 'Reisnudeln Pho 5 mm', vi: 'Bánh phở khô', area: 'DRY', unit: 'Pkg', supplier: 'asia', orderUnit: 'Karton à 30 × 400 g', pack: 30, price: 54, key: true, piece: 1 / 30 },
  { sku: 'A-1003', de: 'Reisnudeln Bun fein', vi: 'Bún khô', area: 'DRY', unit: 'Pkg', supplier: 'asia', orderUnit: 'Karton à 30 × 400 g', pack: 30, price: 51 },
  { sku: 'A-1004', de: 'Reispapier 22 cm', vi: 'Bánh tráng 22 cm', area: 'DRY', unit: 'Pkg', supplier: 'asia', orderUnit: 'Karton à 40 × 400 g', pack: 40, price: 68 },
  { sku: 'A-1005', de: 'Fischsauce 1 l', vi: 'Nước mắm 1 l', area: 'DRY', unit: 'Fl', supplier: 'asia', orderUnit: 'Karton à 12 × 1 l', pack: 12, price: 46.8, key: true, piece: 1 / 12 },
  { sku: 'A-1006', de: 'Sojasauce hell 1.6 l', vi: 'Xì dầu 1.6 l', area: 'DRY', unit: 'Fl', supplier: 'asia', orderUnit: 'Karton à 6 × 1.6 l', pack: 6, price: 32.4, piece: 1 / 6 },
  { sku: 'A-1007', de: 'Hoisinsauce 2.2 kg', vi: 'Tương đen 2.2 kg', area: 'DRY', unit: 'Dose', supplier: 'asia', orderUnit: 'Karton à 6 Dosen', pack: 6, price: 57 },
  { sku: 'A-1008', de: 'Sriracha 740 ml', vi: 'Tương ớt Sriracha', area: 'DRY', unit: 'Fl', supplier: 'asia', orderUnit: 'Karton à 12 Fl', pack: 12, price: 49.2, piece: 1 / 12 },
  { sku: 'A-1009', de: 'Kokosmilch 400 ml', vi: 'Nước cốt dừa 400 ml', area: 'DRY', unit: 'Dose', supplier: 'asia', orderUnit: 'Karton à 24 Dosen', pack: 24, price: 38.4, key: true, piece: 1 / 24 },
  { sku: 'A-1010', de: 'Rote Currypaste 1 kg', vi: 'Cà ri đỏ 1 kg', area: 'DRY', unit: 'Kübel', supplier: 'asia', orderUnit: 'Kübel 1 kg', pack: 1, price: 9.9 },
  { sku: 'A-1011', de: 'Grüne Currypaste 1 kg', vi: 'Cà ri xanh 1 kg', area: 'DRY', unit: 'Kübel', supplier: 'asia', orderUnit: 'Kübel 1 kg', pack: 1, price: 9.9 },
  { sku: 'A-1012', de: 'Tamarindenpaste 454 g', vi: 'Me chua', area: 'DRY', unit: 'Glas', supplier: 'asia', orderUnit: 'Karton à 12 Gläser', pack: 12, price: 30 },
  { sku: 'A-1013', de: 'Palmzucker 1 kg', vi: 'Đường thốt nốt', area: 'DRY', unit: 'Pkg', supplier: 'asia', orderUnit: 'Karton à 10 × 1 kg', pack: 10, price: 39 },
  { sku: 'A-1014', de: 'Frittieröl 10 l', vi: 'Dầu chiên 10 l', area: 'DRY', unit: 'Kanister', supplier: 'asia', orderUnit: 'Kanister 10 l', pack: 1, price: 27.5, key: true },
  // Asia Food – frozen
  { sku: 'A-2001', de: 'Crevetten 16/20 geschält', vi: 'Tôm bóc vỏ 16/20', area: 'FREEZER', unit: 'kg', supplier: 'asia', orderUnit: 'Karton à 10 × 1 kg', pack: 10, price: 189, key: true },
  { sku: 'A-2002', de: 'Frühlingsrollen Gemüse', vi: 'Chả giò chay', area: 'FREEZER', unit: 'Stk', supplier: 'asia', orderUnit: 'Karton à 200 Stk', pack: 200, price: 76 },
  { sku: 'A-2003', de: 'Edamame 500 g', vi: 'Đậu nành Nhật', area: 'FREEZER', unit: 'Pkg', supplier: 'asia', orderUnit: 'Karton à 20 × 500 g', pack: 20, price: 52 },
  // Frischmarkt – fresh, no barcodes
  { sku: 'F-3001', de: 'Koriander', vi: 'Ngò rí', area: 'COLD', unit: 'Bund', supplier: 'frisch', orderUnit: 'Bund', pack: 1, price: 1.2, fresh: true, key: true },
  { sku: 'F-3002', de: 'Thai-Basilikum', vi: 'Húng quế', area: 'COLD', unit: 'Bund', supplier: 'frisch', orderUnit: 'Bund', pack: 1, price: 1.6, fresh: true },
  { sku: 'F-3003', de: 'Minze', vi: 'Húng lủi', area: 'COLD', unit: 'Bund', supplier: 'frisch', orderUnit: 'Bund', pack: 1, price: 1.4, fresh: true },
  { sku: 'F-3004', de: 'Sojasprossen', vi: 'Giá đỗ', area: 'COLD', unit: 'kg', supplier: 'frisch', orderUnit: 'kg', pack: 1, price: 4.2, fresh: true, key: true },
  { sku: 'F-3005', de: 'Limetten', vi: 'Chanh', area: 'COLD', unit: 'kg', supplier: 'frisch', orderUnit: 'kg', pack: 1, price: 5.8, fresh: true },
  { sku: 'F-3006', de: 'Zitronengras', vi: 'Sả', area: 'COLD', unit: 'kg', supplier: 'frisch', orderUnit: 'kg', pack: 1, price: 9.5, fresh: true },
  { sku: 'F-3007', de: 'Rindfleisch Huft, dünn geschnitten', vi: 'Thịt bò thăn', area: 'COLD', unit: 'kg', supplier: 'frisch', orderUnit: 'kg', pack: 1, price: 38, fresh: true, key: true },
  { sku: 'F-3008', de: 'Pouletbrust', vi: 'Ức gà', area: 'COLD', unit: 'kg', supplier: 'frisch', orderUnit: 'kg', pack: 1, price: 19.5, fresh: true, key: true },
  { sku: 'F-3009', de: 'Tofu fest', vi: 'Đậu phụ', area: 'COLD', unit: 'Stk', supplier: 'frisch', orderUnit: 'Karton à 10 × 400 g', pack: 10, price: 21, key: true },
  { sku: 'F-3010', de: 'Rindsknochen für Brühe', vi: 'Xương bò', area: 'COLD', unit: 'kg', supplier: 'frisch', orderUnit: 'kg', pack: 1, price: 4.5, fresh: true },
  // Handel – drinks & bar
  { sku: 'H-4001', de: 'Saigon Bier 33 cl', vi: 'Bia Sài Gòn', area: 'BAR', unit: 'Fl', supplier: 'handel', orderUnit: 'Harass à 24 Fl', pack: 24, price: 43.2, key: true, piece: 1 / 24 },
  { sku: 'H-4002', de: 'Singha Bier 33 cl', vi: 'Bia Singha', area: 'BAR', unit: 'Fl', supplier: 'handel', orderUnit: 'Harass à 24 Fl', pack: 24, price: 45.6, key: true, piece: 1 / 24 },
  { sku: 'H-4003', de: 'Kokoswasser 330 ml', vi: 'Nước dừa', area: 'BAR', unit: 'Dose', supplier: 'handel', orderUnit: 'Tray à 24 Dosen', pack: 24, price: 36, piece: 1 / 24 },
  { sku: 'H-4004', de: 'Vietnam-Kaffee gemahlen 500 g', vi: 'Cà phê Trung Nguyên', area: 'BAR', unit: 'Pkg', supplier: 'handel', orderUnit: 'Pkg 500 g', pack: 1, price: 14.5 },
  { sku: 'H-4005', de: 'Gezuckerte Kondensmilch 397 g', vi: 'Sữa đặc', area: 'BAR', unit: 'Dose', supplier: 'handel', orderUnit: 'Karton à 48 Dosen', pack: 48, price: 79 },
  { sku: 'H-4006', de: 'Jasmintee lose 500 g', vi: 'Trà lài', area: 'BAR', unit: 'Pkg', supplier: 'handel', orderUnit: 'Pkg 500 g', pack: 1, price: 11 },
];

export const SAMPLE_USERS = [
  { email: 'admin@asiaway.test', name: 'Admin (Muster)', grants: [{ role: 'ADMIN' as const, locationId: null }] },
  { email: 'besteller@asiaway.test', name: 'Besteller (Muster)', grants: [{ role: 'ORDERER' as const, locationId: null }] },
  { email: 'oerlikon@asiaway.test', name: 'Mitarbeiter Oerlikon', grants: [{ role: 'STAFF' as const, locationId: 'oerlikon' }] },
  { email: 'winti-vn@asiaway.test', name: 'Mitarbeiter Winti VN', grants: [{ role: 'STAFF' as const, locationId: 'winti-vn' }] },
  { email: 'winti-th@asiaway.test', name: 'Mitarbeiter Winti Thai', grants: [{ role: 'STAFF' as const, locationId: 'winti-th' }] },
];

/** Deterministic sample EAN for an item: 20 + 5-digit item number + 00000 + check digit. */
export function sampleEan(sku: string, variant: 0 | 1 = 0): string {
  const digits = sku.replace(/\D/g, '').padStart(5, '0').slice(-5);
  return makeEan13(`2${variant === 0 ? '0' : '1'}${digits}00000`);
}

export async function isEmpty(db: AppDatabase): Promise<boolean> {
  const result = await db.execute(sql`select count(*)::int as n from users`);
  const rows = (result as unknown as { rows?: { n: number }[] }).rows ?? (result as unknown as { n: number }[]);
  return Number(rows[0]?.n ?? 0) === 0;
}

export async function seedIfEmpty(db: AppDatabase): Promise<boolean> {
  if (!(await isEmpty(db))) return false;
  await seedSampleData(db);
  return true;
}

export async function seedSampleData(
  db: AppDatabase,
  { password = process.env.SEED_PASSWORD || 'asiaway-dev', withOrders = true, withUsers = true } = {},
): Promise<void> {
  await db.insert(locations).values([...LOCATIONS]).onConflictDoNothing();

  const supplierIds: Record<string, string> = {};
  for (const s of SUPPLIERS) {
    const { key, ...values } = s;
    const [row] = await db.insert(suppliers).values(values).returning({ id: suppliers.id });
    supplierIds[key] = row!.id;
  }

  const itemIds: Record<string, string> = {};
  for (const it of ITEMS) {
    const [row] = await db
      .insert(items)
      .values({ sku: it.sku, nameDe: it.de, nameVi: it.vi, storageArea: it.area, stockUnit: it.unit, isFresh: Boolean(it.fresh), isKeyItem: Boolean(it.key) })
      .returning({ id: items.id });
    itemIds[it.sku] = row!.id;
    await db.insert(supplierItems).values({
      supplierId: supplierIds[it.supplier]!,
      itemId: row!.id,
      supplierSku: `${it.supplier.toUpperCase().slice(0, 2)}-${it.sku.slice(2)}`,
      orderUnit: it.orderUnit,
      packSize: String(it.pack),
      priceCents: Math.round(it.price * 100),
    });
    if (!it.fresh) {
      await db.insert(itemBarcodes).values({ code: sampleEan(it.sku, 0), itemId: row!.id, unitsPerScan: '1', label: it.orderUnit });
      if (it.piece) {
        await db.insert(itemBarcodes).values({ code: sampleEan(it.sku, 1), itemId: row!.id, unitsPerScan: it.piece.toFixed(4), label: 'Einzelstück' });
      }
    }
  }

  if (!withUsers) return;

  const hash = await hashPassword(password);
  const userIds: Record<string, string> = {};
  for (const u of SAMPLE_USERS) {
    const [row] = await db.insert(users).values({ email: u.email, name: u.name, passwordHash: hash }).returning({ id: users.id });
    userIds[u.email] = row!.id;
    await db.insert(userRoles).values(u.grants.map((g) => ({ userId: row!.id, role: g.role, locationId: g.locationId })));
  }

  if (!withOrders) return;

  const principal = async (email: string) => (await loadPrincipalForUser(db, userIds[email]!)) as Principal;
  const orderer = await principal('besteller@asiaway.test');
  const today = todayIso();

  // Oerlikon: a draft in progress
  const oer = await principal('oerlikon@asiaway.test');
  const d1 = await openDraft(db, oer, 'oerlikon', supplierIds.asia!);
  await setLineQty(db, oer, d1.id, itemIds['A-1001']!, 3);
  await setLineQty(db, oer, d1.id, itemIds['A-1005']!, 2);
  await setLineQty(db, oer, d1.id, itemIds['A-1009']!, 4);
  await updateOrderDetails(db, oer, d1.id, { deliveryDate: addDaysIso(today, 3), note: null });

  // Winterthur VN: submitted, waiting for the orderer
  const wvn = await principal('winti-vn@asiaway.test');
  const d2 = await openDraft(db, wvn, 'winti-vn', supplierIds.frisch!);
  await setLineQty(db, wvn, d2.id, itemIds['F-3001']!, 10);
  await setLineQty(db, wvn, d2.id, itemIds['F-3004']!, 3);
  await setLineQty(db, wvn, d2.id, itemIds['F-3007']!, 6.5);
  await setLineQty(db, wvn, d2.id, itemIds['F-3009']!, 2);
  await updateOrderDetails(db, wvn, d2.id, { deliveryDate: addDaysIso(today, 1), note: 'Bitte Koriander mit Wurzeln.' });
  await submitOrder(db, wvn, d2.id);

  // Winterthur Thai: sent, ready to receive
  const wth = await principal('winti-th@asiaway.test');
  const d3 = await openDraft(db, wth, 'winti-th', supplierIds.asia!);
  await setLineQty(db, wth, d3.id, itemIds['A-1009']!, 2);
  await setLineQty(db, wth, d3.id, itemIds['A-1010']!, 3);
  await setLineQty(db, wth, d3.id, itemIds['A-1011']!, 3);
  await setLineQty(db, wth, d3.id, itemIds['A-1005']!, 1);
  await setLineQty(db, wth, d3.id, itemIds['A-2001']!, 1);
  await updateOrderDetails(db, wth, d3.id, { deliveryDate: today, note: null });
  await submitOrder(db, wth, d3.id);
  await sendOrder(db, orderer, d3.id, new MemoryMailer(), 'seed@asiaway.test');

  // Oerlikon: sent drinks order from Handel, for a second goods-in example
  const d4 = await openDraft(db, oer, 'oerlikon', supplierIds.handel!);
  await setLineQty(db, oer, d4.id, itemIds['H-4001']!, 3);
  await setLineQty(db, oer, d4.id, itemIds['H-4002']!, 2);
  await setLineQty(db, oer, d4.id, itemIds['H-4003']!, 1);
  await updateOrderDetails(db, oer, d4.id, { deliveryDate: today, note: null });
  await submitOrder(db, oer, d4.id);
  await sendOrder(db, orderer, d4.id, new MemoryMailer(), 'seed@asiaway.test');
}

export const SAMPLE_ITEM_COUNT = ITEMS.length;
