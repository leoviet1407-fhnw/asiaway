import { and, desc, eq, inArray } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isPlanner, type Principal } from '../../domain/roles';
import { checkShiftTimes, mondayOf } from '../../domain/roster';
import { todayIso } from '../../lib/dates';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { changeRequests, rosterWeeks, shifts, users } from '../db/schema';
import { correctShift, isMonthApproved, saveEntry } from './hours-service';
import { getProfile } from './roster-service';

/**
 * Staff do not edit the roster or their worked hours themselves: they ask for a
 * change in the app, with a reason, and the Leitung (planners) approves or rejects it.
 */
export type ChangeKind = 'SHIFT_CHANGE' | 'SHIFT_CANCEL' | 'WORKED_TIME';
export type ChangeStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export interface ChangeRequestInput {
  kind: ChangeKind;
  shiftId?: string | null;
  /** Needed for extra hours without a planned shift. */
  date?: string | null;
  startMin?: number | null;
  endMin?: number | null;
  breakMin?: number;
  reason: string;
}

const uuid = (v: string | null | undefined) => !!v && /^[0-9a-f-]{36}$/i.test(v);

export async function requestChange(db: AppDatabase, p: Principal, input: ChangeRequestInput, now = new Date()): Promise<string> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw domainError('VALIDATION_FAILED', 'Bitte einen Grund angeben.');
  if (!(await getProfile(db, p.userId))) throw domainError('VALIDATION_FAILED', 'Kein Team-Profil.');
  const today = todayIso(now);
  let date = input.date ?? '';
  let shiftId: string | null = null;
  if (input.shiftId) {
    if (!uuid(input.shiftId)) throw domainError('NOT_FOUND', 'Shift not found');
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, input.shiftId)).limit(1);
    if (!shift || shift.userId !== p.userId) throw domainError('NOT_FOUND', 'Shift not found');
    const [week] = await db.select().from(rosterWeeks).where(and(eq(rosterWeeks.site, shift.site), eq(rosterWeeks.weekStart, mondayOf(shift.workDate)))).limit(1);
    if (week?.status !== 'PUBLISHED') throw domainError('NOT_FOUND', 'Shift not found');
    shiftId = shift.id;
    date = shift.workDate;
    const open = await db.select({ id: changeRequests.id }).from(changeRequests).where(and(eq(changeRequests.shiftId, shiftId), eq(changeRequests.status, 'REQUESTED'))).limit(1);
    if (open.length) throw domainError('VALIDATION_FAILED', 'Für diese Schicht gibt es schon eine offene Anfrage.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw domainError('VALIDATION_FAILED', 'Datum ist ungültig.');

  let startMin: number | null = null;
  let endMin: number | null = null;
  const breakMin = input.breakMin ?? 0;
  if (input.kind === 'SHIFT_CANCEL') {
    if (!shiftId) throw domainError('VALIDATION_FAILED', 'Schicht fehlt.');
    if (date < today) throw domainError('VALIDATION_FAILED', 'Diese Schicht ist schon vorbei.');
  } else {
    if (input.startMin == null || input.endMin == null) throw domainError('VALIDATION_FAILED', 'Bitte Beginn und Ende angeben.');
    const problem = checkShiftTimes(input.startMin, input.endMin, breakMin);
    if (problem) throw domainError('VALIDATION_FAILED', problem);
    startMin = input.startMin;
    endMin = input.endMin;
    if (input.kind === 'SHIFT_CHANGE') {
      if (!shiftId) throw domainError('VALIDATION_FAILED', 'Schicht fehlt.');
      if (date < today) throw domainError('VALIDATION_FAILED', 'Diese Schicht ist schon vorbei.');
    } else {
      if (date > today) throw domainError('VALIDATION_FAILED', 'Arbeitszeit kann erst nach dem Einsatz erfasst werden.');
      if (await isMonthApproved(db, p.userId, date.slice(0, 7))) throw domainError('MONTH_LOCKED', 'Month approved');
    }
  }
  const [row] = await db
    .insert(changeRequests)
    .values({ userId: p.userId, kind: input.kind, shiftId, workDate: date, startMin, endMin, breakMin, reason, createdAt: now })
    .returning({ id: changeRequests.id });
  await audit(db, p.userId, 'change.request', 'change_request', row!.id, { kind: input.kind, date });
  return row!.id;
}

export interface ChangeRequestRow {
  id: string;
  userId: string;
  userName: string;
  kind: ChangeKind;
  shiftId: string | null;
  date: string;
  startMin: number | null;
  endMin: number | null;
  breakMin: number;
  reason: string;
  status: ChangeStatus;
  createdAt: Date;
  decidedAt: Date | null;
  shift: { site: string; startMin: number; endMin: number; station: string; roleLabel: string | null } | null;
}

/** Planners see everybody's requests, staff only their own. */
export async function listChangeRequests(db: AppDatabase, p: Principal, { open = false, limit = 60 }: { open?: boolean; limit?: number } = {}): Promise<ChangeRequestRow[]> {
  const rows = await db
    .select({ c: changeRequests, name: users.name })
    .from(changeRequests)
    .innerJoin(users, eq(users.id, changeRequests.userId))
    .where(and(...(isPlanner(p) ? [] : [eq(changeRequests.userId, p.userId)]), ...(open ? [eq(changeRequests.status, 'REQUESTED')] : [])))
    .orderBy(desc(changeRequests.createdAt))
    .limit(limit);
  const ids = rows.map((r) => r.c.shiftId).filter((x): x is string => !!x);
  const sh = ids.length ? await db.select().from(shifts).where(inArray(shifts.id, ids)) : [];
  return rows.map(({ c, name }) => {
    const s = sh.find((x) => x.id === c.shiftId);
    return {
      id: c.id,
      userId: c.userId,
      userName: name,
      kind: c.kind as ChangeKind,
      shiftId: c.shiftId,
      date: c.workDate,
      startMin: c.startMin,
      endMin: c.endMin,
      breakMin: c.breakMin,
      reason: c.reason,
      status: c.status as ChangeStatus,
      createdAt: c.createdAt,
      decidedAt: c.decidedAt,
      shift: s ? { site: s.site, startMin: s.startMin, endMin: s.endMin, station: s.station, roleLabel: s.roleLabel } : null,
    };
  });
}

export async function countOpenRequests(db: AppDatabase, p: Principal): Promise<number> {
  return (await listChangeRequests(db, p, { open: true, limit: 200 })).length;
}

export async function decideChangeRequest(db: AppDatabase, p: Principal, id: string, approve: boolean, now = new Date()): Promise<void> {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung kann Anfragen entscheiden.');
  if (!uuid(id)) throw domainError('NOT_FOUND', 'Request not found');
  const [c] = await db.select().from(changeRequests).where(eq(changeRequests.id, id)).limit(1);
  if (!c) throw domainError('NOT_FOUND', 'Request not found');
  if (c.status !== 'REQUESTED') throw domainError('VALIDATION_FAILED', 'Diese Anfrage ist schon entschieden.');
  if (approve) {
    await db.transaction(async (tx) => {
      const t = tx as unknown as AppDatabase;
      if (c.kind === 'SHIFT_CHANGE') {
        if (!c.shiftId || c.startMin == null || c.endMin == null) throw domainError('VALIDATION_FAILED', 'Anfrage ist unvollständig.');
        await t.update(shifts).set({ startMin: c.startMin, endMin: c.endMin, breakMin: c.breakMin, updatedAt: now }).where(eq(shifts.id, c.shiftId));
      } else if (c.kind === 'SHIFT_CANCEL') {
        if (!c.shiftId) throw domainError('VALIDATION_FAILED', 'Anfrage ist unvollständig.');
        // The shift stays in the plan as an open shift so the Leitung can find someone else
        await t.update(shifts).set({ userId: null, updatedAt: now }).where(eq(shifts.id, c.shiftId));
      } else {
        if (c.startMin == null || c.endMin == null) throw domainError('VALIDATION_FAILED', 'Anfrage ist unvollständig.');
        const times = { startMin: c.startMin, endMin: c.endMin, breakMin: c.breakMin, note: c.reason };
        if (c.shiftId) await correctShift(t, p, c.shiftId, times, now);
        else await saveEntry(t, p, { userId: c.userId, date: c.workDate, ...times }, now);
      }
      await t.update(changeRequests).set({ status: 'APPROVED', decidedBy: p.userId, decidedAt: now }).where(eq(changeRequests.id, id));
    });
  } else {
    await db.update(changeRequests).set({ status: 'REJECTED', decidedBy: p.userId, decidedAt: now }).where(eq(changeRequests.id, id));
  }
  await audit(db, p.userId, approve ? 'change.approve' : 'change.reject', 'change_request', id, { kind: c.kind });
}

export async function withdrawChangeRequest(db: AppDatabase, p: Principal, id: string): Promise<void> {
  if (!uuid(id)) throw domainError('NOT_FOUND', 'Request not found');
  const [c] = await db.select().from(changeRequests).where(eq(changeRequests.id, id)).limit(1);
  if (!c || c.userId !== p.userId) throw domainError('NOT_FOUND', 'Request not found');
  if (c.status !== 'REQUESTED') throw domainError('VALIDATION_FAILED', 'Diese Anfrage ist schon entschieden.');
  await db.update(changeRequests).set({ status: 'WITHDRAWN', decidedAt: new Date() }).where(eq(changeRequests.id, id));
}
