import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import { computeClosing, stationsFor, type ClosingResult, type ClosingStatus } from '../../domain/closing';
import { domainError } from '../../domain/errors';
import { canAccessLocation, isOrderer, type Principal } from '../../domain/roles';
import { todayIso } from '../../lib/dates';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { closingPhotos, dailyClosings, locations, users } from '../db/schema';

export interface ClosingValues {
  cashCountedCents: number;
  startFloatCents: number;
  eftCents: number;
  mobileCents: number;
  posGrossCents: number;
  note: string | null;
}

export interface ClosingView extends ClosingValues {
  id: string;
  locationId: string;
  locationName: string;
  businessDate: string;
  station: string;
  status: ClosingStatus;
  closedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedByName: string | null;
  approvedAt: Date | null;
  result: ClosingResult;
}

type Row = typeof dailyClosings.$inferSelect;

async function toViews(db: AppDatabase, rows: Row[]): Promise<ClosingView[]> {
  if (rows.length === 0) return [];
  const locs = new Map((await db.select().from(locations)).map((l) => [l.id, l.name]));
  const people = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    locationId: r.locationId,
    locationName: locs.get(r.locationId) ?? r.locationId,
    businessDate: r.businessDate,
    station: r.station,
    status: r.status as ClosingStatus,
    cashCountedCents: r.cashCountedCents,
    startFloatCents: r.startFloatCents,
    eftCents: r.eftCents,
    mobileCents: r.mobileCents,
    posGrossCents: r.posGrossCents,
    note: r.note,
    closedByName: people.get(r.closedBy) ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    approvedByName: r.approvedBy ? people.get(r.approvedBy) ?? null : null,
    approvedAt: r.approvedAt,
    result: computeClosing(r),
  }));
}

function checkValues(v: ClosingValues): void {
  const amounts = { cashCountedCents: v.cashCountedCents, startFloatCents: v.startFloatCents, eftCents: v.eftCents, mobileCents: v.mobileCents, posGrossCents: v.posGrossCents };
  for (const [field, value] of Object.entries(amounts)) {
    if (!Number.isInteger(value) || value < 0 || value > 100_000_000) {
      throw domainError('VALIDATION_FAILED', 'Ein Betrag ist ungültig.', { field });
    }
  }
  if ((v.note ?? '').length > 1000) throw domainError('VALIDATION_FAILED', 'Notiz ist zu lang.');
}

function canSee(p: Principal, locationId: string): boolean {
  return isOrderer(p) || canAccessLocation(p, locationId);
}

export async function getClosing(db: AppDatabase, p: Principal, id: string): Promise<ClosingView> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw domainError('NOT_FOUND', 'Closing not found');
  const [row] = await db.select().from(dailyClosings).where(eq(dailyClosings.id, id)).limit(1);
  if (!row) throw domainError('NOT_FOUND', 'Closing not found');
  if (!canSee(p, row.locationId)) throw domainError('FORBIDDEN', 'Not your location');
  return (await toViews(db, [row]))[0]!;
}

/** The closing for a day and station, if one exists (used to open it instead of creating a second). */
export async function findClosing(db: AppDatabase, p: Principal, locationId: string, date: string, station: string) {
  const [row] = await db
    .select({ id: dailyClosings.id })
    .from(dailyClosings)
    .where(and(eq(dailyClosings.locationId, locationId), eq(dailyClosings.businessDate, date), eq(dailyClosings.station, station)))
    .limit(1);
  if (row && !canSee(p, locationId)) throw domainError('FORBIDDEN', 'Not your location');
  return row?.id ?? null;
}

export async function listClosings(db: AppDatabase, p: Principal, { month, locationId }: { month: string; locationId?: string }): Promise<ClosingView[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw domainError('VALIDATION_FAILED', 'Invalid month');
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const rows = await db
    .select()
    .from(dailyClosings)
    .where(
      and(
        gte(dailyClosings.businessDate, from),
        lt(dailyClosings.businessDate, to),
        ...(locationId ? [eq(dailyClosings.locationId, locationId)] : []),
      ),
    )
    .orderBy(desc(dailyClosings.businessDate), asc(dailyClosings.locationId), asc(dailyClosings.station));
  return toViews(db, rows.filter((r) => canSee(p, r.locationId)));
}

export interface SaveClosingInput extends ClosingValues {
  id?: string | undefined;
  locationId: string;
  businessDate: string;
  station: string;
}

/**
 * Saves a closing. A new one needs a location the user works at, a date that is
 * not in the future and one of the location's stations. Once APPROVED it is
 * locked until an orderer reopens it. There is one closing per day and station.
 */
export async function saveClosing(db: AppDatabase, p: Principal, input: SaveClosingInput, now = new Date()): Promise<string> {
  checkValues(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) throw domainError('VALIDATION_FAILED', 'Datum ist ungültig.');
  if (input.businessDate > todayIso(now)) throw domainError('VALIDATION_FAILED', 'Das Datum liegt in der Zukunft.');
  const values = {
    cashCountedCents: input.cashCountedCents,
    startFloatCents: input.startFloatCents,
    eftCents: input.eftCents,
    mobileCents: input.mobileCents,
    posGrossCents: input.posGrossCents,
    note: input.note?.trim() || null,
    updatedBy: p.userId,
    updatedAt: now,
  };

  if (input.id) {
    const [row] = await db.select().from(dailyClosings).where(eq(dailyClosings.id, input.id)).limit(1);
    if (!row) throw domainError('NOT_FOUND', 'Closing not found');
    if (!canSee(p, row.locationId)) throw domainError('FORBIDDEN', 'Not your location');
    if (row.status === 'APPROVED') throw domainError('CLOSING_LOCKED', 'Closing is approved');
    await db.update(dailyClosings).set(values).where(eq(dailyClosings.id, row.id));
    await audit(db, p.userId, 'closing.update', 'daily_closing', row.id, { date: row.businessDate, station: row.station });
    return row.id;
  }

  if (!canAccessLocation(p, input.locationId)) throw domainError('FORBIDDEN', 'Not your location');
  if (!stationsFor(input.locationId).includes(input.station)) throw domainError('VALIDATION_FAILED', 'Station ist ungültig.');
  if (await findClosing(db, p, input.locationId, input.businessDate, input.station)) {
    throw domainError('VALIDATION_FAILED', 'Für diesen Tag und diese Station gibt es schon einen Abschluss.');
  }
  const [row] = await db
    .insert(dailyClosings)
    .values({ locationId: input.locationId, businessDate: input.businessDate, station: input.station, closedBy: p.userId, createdAt: now, ...values })
    .returning({ id: dailyClosings.id });
  await audit(db, p.userId, 'closing.create', 'daily_closing', row!.id, { date: input.businessDate, station: input.station });
  return row!.id;
}

/** An orderer or admin signs the closing off; afterwards it cannot be changed. */
export async function approveClosing(db: AppDatabase, p: Principal, id: string, now = new Date()): Promise<void> {
  if (!isOrderer(p)) throw domainError('FORBIDDEN', 'Orderers only');
  const closing = await getClosing(db, p, id);
  if (closing.status === 'APPROVED') return;
  await db.update(dailyClosings).set({ status: 'APPROVED', approvedBy: p.userId, approvedAt: now }).where(eq(dailyClosings.id, id));
  await audit(db, p.userId, 'closing.approve', 'daily_closing', id, { difference: closing.result.differenceCents });
}

export async function reopenClosing(db: AppDatabase, p: Principal, id: string): Promise<void> {
  if (!isOrderer(p)) throw domainError('FORBIDDEN', 'Orderers only');
  await getClosing(db, p, id);
  await db.update(dailyClosings).set({ status: 'SUBMITTED', approvedBy: null, approvedAt: null }).where(eq(dailyClosings.id, id));
  await audit(db, p.userId, 'closing.reopen', 'daily_closing', id);
}

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export async function addClosingPhoto(db: AppDatabase, p: Principal, closingId: string, mime: string, data: Buffer): Promise<string> {
  const closing = await getClosing(db, p, closingId);
  if (closing.status === 'APPROVED') throw domainError('CLOSING_LOCKED', 'Closing is approved');
  if (!PHOTO_TYPES.has(mime)) throw domainError('VALIDATION_FAILED', 'Nur JPEG-, PNG- oder WebP-Fotos.');
  if (data.length === 0 || data.length > MAX_PHOTO_BYTES) throw domainError('VALIDATION_FAILED', 'Foto ist leer oder zu gross.');
  const [row] = await db.insert(closingPhotos).values({ closingId, mime, data, createdBy: p.userId }).returning({ id: closingPhotos.id });
  await audit(db, p.userId, 'closing.photo', 'daily_closing', closingId, { bytes: data.length });
  return row!.id;
}

export async function listClosingPhotos(db: AppDatabase, p: Principal, closingId: string) {
  await getClosing(db, p, closingId);
  return db
    .select({ id: closingPhotos.id, createdAt: closingPhotos.createdAt })
    .from(closingPhotos)
    .where(eq(closingPhotos.closingId, closingId))
    .orderBy(asc(closingPhotos.createdAt));
}

export async function getClosingPhoto(db: AppDatabase, p: Principal, photoId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(photoId)) throw domainError('NOT_FOUND', 'Photo not found');
  const [photo] = await db.select().from(closingPhotos).where(eq(closingPhotos.id, photoId)).limit(1);
  if (!photo) throw domainError('NOT_FOUND', 'Photo not found');
  await getClosing(db, p, photo.closingId);
  return photo;
}

/** The sum over a list: what the accountant needs for a month. */
export function sumClosings(list: readonly ClosingView[]) {
  return list.reduce(
    (s, c) => ({
      posGrossCents: s.posGrossCents + c.posGrossCents,
      eftCents: s.eftCents + c.eftCents,
      mobileCents: s.mobileCents + c.mobileCents,
      cashSalesCents: s.cashSalesCents + c.result.cashSalesCents,
      tipsCents: s.tipsCents + c.result.tipsCents,
      shortfallCents: s.shortfallCents + c.result.shortfallCents,
      bankDepositCents: s.bankDepositCents + c.result.bankDepositCents,
    }),
    { posGrossCents: 0, eftCents: 0, mobileCents: 0, cashSalesCents: 0, tipsCents: 0, shortfallCents: 0, bankDepositCents: 0 },
  );
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const chf = (cents: number) => (cents / 100).toFixed(2);

/** Semicolon CSV (opens directly in Swiss Excel) of the closings of a month. */
export function closingsToCsv(list: readonly ClosingView[]): string {
  const header = [
    'Datum', 'Standort', 'Station', 'Kassenbestand', 'Anfangsbestand', 'Barumsatz', 'EFT', 'Mobile', 'Total IST',
    'Kasse Brutto SOLL', 'Differenz', 'Bank einzahlen', 'Status', 'Abgeschlossen von', 'Freigegeben von', 'Notiz',
  ];
  const lines = list.map((c) =>
    [
      c.businessDate, c.locationName, c.station, chf(c.cashCountedCents), chf(c.startFloatCents), chf(c.result.cashSalesCents),
      chf(c.eftCents), chf(c.mobileCents), chf(c.result.totalActualCents), chf(c.posGrossCents), chf(c.result.differenceCents),
      chf(c.result.bankDepositCents), c.status === 'APPROVED' ? 'freigegeben' : 'abgeschlossen', c.closedByName ?? '', c.approvedByName ?? '', c.note ?? '',
    ]
      .map(csvCell)
      .join(';'),
  );
  return '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n';
}
