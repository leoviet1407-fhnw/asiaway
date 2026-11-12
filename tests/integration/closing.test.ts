import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { computeClosing, differenceTone, closingWarnings } from '@/domain/closing';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import {
  addClosingPhoto,
  approveClosing,
  closingsToCsv,
  getClosing,
  listClosings,
  reopenClosing,
  saveClosing,
  sumClosings,
} from '@/server/services/closing-service';
import { createTestDatabase } from '../helpers/db';

// The numbers of the handwritten form of 12 Nov (1. OG).
const FORM = { cashCountedCents: 72800, startFloatCents: 30000, eftCents: 226725, mobileCents: 0, posGrossCents: 258460, note: null };

describe('closing rules', () => {
  it('reproduces the paper form', () => {
    expect(computeClosing(FORM)).toEqual({
      cashSalesCents: 42800,
      totalActualCents: 269525,
      differenceCents: 11065,
      tipsCents: 11065,
      shortfallCents: 0,
      bankDepositCents: 31735,
    });
  });
  it('cash to bank equals cash sales minus tips, also with mobile payments', () => {
    const r = computeClosing({ ...FORM, mobileCents: 5000, posGrossCents: 258460, cashCountedCents: 72800 });
    expect(r.bankDepositCents).toBe(258460 - 226725 - 5000);
    expect(r.bankDepositCents).toBe(r.cashSalesCents - r.tipsCents);
  });
  it('flags a shortfall', () => {
    const r = computeClosing({ ...FORM, cashCountedCents: 40000 });
    expect(r.differenceCents).toBe(-21735);
    expect(r.shortfallCents).toBe(21735);
    expect(r.tipsCents).toBe(0);
    expect(differenceTone(r.differenceCents)).toBe('short');
    expect(differenceTone(0)).toBe('ok');
    expect(closingWarnings({ ...FORM, cashCountedCents: 40000 }).join(' ')).toMatch(/Fehlbetrag/);
    expect(closingWarnings({ ...FORM, cashCountedCents: 100 }).join(' ')).toMatch(/kleiner als der Anfangsbestand/);
  });
});

describe('closing service', () => {
  let db: AppDatabase;
  let close: () => Promise<void>;
  let staffVn: Principal;
  let staffTh: Principal;
  let orderer: Principal;
  const principal = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadPrincipalForUser(db, u!.id))!;
  };
  const now = new Date('2026-11-13T09:00:00Z');

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await seedSampleData(db, { password: 'test-password', withOrders: false });
    staffVn = await principal('winti-vn@asiaway.test');
    staffTh = await principal('winti-th@asiaway.test');
    orderer = await principal('besteller@asiaway.test');
  });
  afterAll(async () => close());

  const input = { ...FORM, locationId: 'winti-vn', businessDate: '2026-11-12', station: '1. OG' };

  it('saves, then edits, and keeps one closing per day and station', async () => {
    const id = await saveClosing(db, staffVn, input, now);
    const view = await getClosing(db, staffVn, id);
    expect(view.result.bankDepositCents).toBe(31735);
    expect(view.closedByName).toBe(staffVn.name);
    await expect(saveClosing(db, staffVn, input, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await saveClosing(db, staffVn, { ...input, id, eftCents: 200000 }, now);
    expect((await getClosing(db, staffVn, id)).eftCents).toBe(200000);
  });

  it('checks location, date, station and amounts', async () => {
    await expect(saveClosing(db, staffTh, { ...input, station: '1. OG' }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(saveClosing(db, staffVn, { ...input, businessDate: '2026-11-14', station: 'Buffet' }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(saveClosing(db, staffVn, { ...input, businessDate: '2026-11-11', station: 'Keller' }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(saveClosing(db, staffVn, { ...input, businessDate: '2026-11-11', eftCents: -5 }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(saveClosing(db, staffVn, { ...input, businessDate: '2026-11-11', eftCents: 10.5 }, now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('approval locks the closing; only an orderer approves or reopens', async () => {
    const id = await saveClosing(db, staffVn, { ...input, businessDate: '2026-11-10' }, now);
    await expect(approveClosing(db, staffVn, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approveClosing(db, orderer, id, now);
    const approved = await getClosing(db, staffVn, id);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedByName).toBe(orderer.name);
    await expect(saveClosing(db, staffVn, { ...input, id, businessDate: '2026-11-10', eftCents: 1 }, now)).rejects.toMatchObject({ code: 'CLOSING_LOCKED' });
    await expect(addClosingPhoto(db, staffVn, id, 'image/jpeg', Buffer.from([1]))).rejects.toMatchObject({ code: 'CLOSING_LOCKED' });
    await expect(reopenClosing(db, staffVn, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await reopenClosing(db, orderer, id);
    await saveClosing(db, staffVn, { ...input, id, businessDate: '2026-11-10', eftCents: 1 }, now);
  });

  it('keeps staff out of other locations; lists, sums and exports a month', async () => {
    await saveClosing(db, orderer, { ...input, locationId: 'winti-th', station: 'EG', businessDate: '2026-11-12', cashCountedCents: 50000, posGrossCents: 20000, eftCents: 0 }, now).catch(() => undefined);
    const mineVn = await listClosings(db, staffVn, { month: '2026-11' });
    expect(mineVn.every((c) => c.locationId === 'winti-vn')).toBe(true);
    const all = await listClosings(db, orderer, { month: '2026-11' });
    expect(all.length).toBeGreaterThanOrEqual(mineVn.length);
    const sum = sumClosings(mineVn);
    expect(sum.posGrossCents).toBe(mineVn.reduce((s, c) => s + c.posGrossCents, 0));
    const csv = closingsToCsv(all);
    expect(csv.startsWith('﻿Datum;Standort;Station')).toBe(true);
    expect(csv.split('\r\n').length).toBe(all.length + 2);
    const photoId = await addClosingPhoto(db, staffVn, mineVn[0]!.id, 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(photoId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(listClosings(db, orderer, { month: '2026-13x' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
