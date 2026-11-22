import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Principal } from '@/domain/roles';
import type { AppDatabase } from '@/server/db/client';
import { absences, users } from '@/server/db/schema';
import { loadPrincipalForUser } from '@/server/auth/session';
import { seedSampleData } from '@/server/seed/sample-data';
import { answerRejectedAbsence, cancelAbsence, decideAbsence, requestAbsence } from '@/server/services/roster-service';
import { createTestDatabase } from '../helpers/db';

let db: AppDatabase;
let close: () => Promise<void>;
let planner: Principal;
let staff: Principal;
let other: Principal;
const now = new Date('2026-11-23T10:00:00Z');

async function principal(email: string): Promise<Principal> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return (await loadPrincipalForUser(db, u!.id))!;
}
const row = async (id: string) => (await db.select().from(absences).where(eq(absences.id, id)))[0];
const ask = (from: string, to: string) => requestAbsence(db, staff, { userId: staff.userId, startDate: from, endDate: to, type: 'VACATION', note: 'Familie' }, now);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedSampleData(db, { password: 'test-password', withOrders: false });
  planner = await principal('besteller@asiaway.test');
  staff = await principal('winti-vn@asiaway.test');
  other = await principal('winti-th@asiaway.test');
}, 60_000);

afterAll(async () => close());

describe('holiday request: answer to a "no"', () => {
  it('the Leitung rejects with a reason and suggested days; the person takes them and is approved at once', async () => {
    const id = await ask('2027-02-08', '2027-02-12');
    await decideAbsence(db, planner, id, false, now, { note: 'Schon 2 Personen weg', suggestedStart: '2027-02-15', suggestedEnd: '2027-02-19' });
    expect(await row(id)).toMatchObject({ status: 'REJECTED', decisionNote: 'Schon 2 Personen weg', suggestedStart: '2027-02-15', suggestedEnd: '2027-02-19' });
    await expect(answerRejectedAbsence(db, other, id, { kind: 'accept' }, now)).rejects.toThrow(); // only the person themself
    const newId = await answerRejectedAbsence(db, staff, id, { kind: 'accept' }, now);
    expect(await row(id)).toBeUndefined();
    expect(await row(newId!)).toMatchObject({ status: 'APPROVED', startDate: '2027-02-15', endDate: '2027-02-19', decidedBy: planner.userId, note: 'Familie' });
  });

  it('other days: a normal new request, the old "no" goes away', async () => {
    const id = await ask('2027-03-01', '2027-03-03');
    await decideAbsence(db, planner, id, false, now, { note: 'Messe' });
    await expect(answerRejectedAbsence(db, staff, id, { kind: 'accept' }, now)).rejects.toThrow(/keinen Vorschlag/);
    const newId = await answerRejectedAbsence(db, staff, id, { kind: 'other', startDate: '2027-03-08', endDate: '2027-03-09' }, now);
    expect(await row(id)).toBeUndefined();
    expect(await row(newId!)).toMatchObject({ status: 'REQUESTED', startDate: '2027-03-08', endDate: '2027-03-09' });
  });

  it('drop: the rejected request is removed; a pending one cannot be answered', async () => {
    const id = await ask('2027-04-05', '2027-04-06');
    await expect(answerRejectedAbsence(db, staff, id, { kind: 'drop' }, now)).rejects.toThrow(/nicht abgelehnt/);
    await decideAbsence(db, planner, id, false, now);
    await answerRejectedAbsence(db, staff, id, { kind: 'drop' }, now);
    expect(await row(id)).toBeUndefined();
  });

  it('suggestions must be valid days; approving clears an old suggestion; staff may remove a rejected request', async () => {
    const id = await ask('2027-05-03', '2027-05-04');
    await expect(decideAbsence(db, planner, id, false, now, { suggestedStart: '2027-05-10', suggestedEnd: '2027-05-07' })).rejects.toThrow(/ungültiges Datum/);
    await expect(decideAbsence(db, planner, id, false, now, { suggestedStart: '2026-01-05' })).rejects.toThrow(/Vergangenheit/);
    await decideAbsence(db, planner, id, false, now, { suggestedStart: '2027-05-10' });
    expect(await row(id)).toMatchObject({ suggestedStart: '2027-05-10', suggestedEnd: '2027-05-10' });
    await decideAbsence(db, planner, id, true, now);
    expect(await row(id)).toMatchObject({ status: 'APPROVED', suggestedStart: null, decisionNote: null });
    const id2 = await ask('2027-06-07', '2027-06-08');
    await decideAbsence(db, planner, id2, false, now);
    await cancelAbsence(db, staff, id2);
    expect(await row(id2)).toBeUndefined();
  });
});
