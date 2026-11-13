import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { domainError } from '../../domain/errors';
import { isPlanner, type Principal } from '../../domain/roles';
import { ROSTER_SITES } from '../../domain/roster';
import { vacationConflict, type SpecialDay, type VacationRule } from '../../domain/season';
import { audit } from '../audit';
import type { AppDatabase } from '../db/client';
import { absences, specialDays, staffProfiles, vacationRules } from '../db/schema';

function requirePlanner(p: Principal) {
  if (!isPlanner(p)) throw domainError('FORBIDDEN', 'Nur die Leitung.');
}
function requireSite(siteId: string) {
  if (!ROSTER_SITES.some((s) => s.id === siteId)) throw domainError('NOT_FOUND', 'Unknown site');
}
const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

// --- Special days (holidays, Silvester, closed days) ------------------------------------------
export async function listSpecialDays(db: AppDatabase, siteId: string, from: string, to: string): Promise<SpecialDay[]> {
  const rows = await db.select().from(specialDays).where(and(eq(specialDays.site, siteId), gte(specialDays.workDate, from), lte(specialDays.workDate, to))).orderBy(asc(specialDays.workDate));
  return rows.map((r) => ({ date: r.workDate, label: r.label, closed: r.closed, lunchPeople: r.lunchPeople, dinnerPeople: r.dinnerPeople }));
}

export async function saveSpecialDay(db: AppDatabase, p: Principal, siteId: string, input: SpecialDay): Promise<void> {
  requirePlanner(p);
  requireSite(siteId);
  if (!isoDate(input.date)) throw domainError('VALIDATION_FAILED', 'Datum ist ungültig.');
  const label = input.label.trim();
  if (!label) throw domainError('VALIDATION_FAILED', 'Bitte einen Namen angeben (z. B. Weihnachten).');
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= 60;
  if (!ok(input.lunchPeople) || !ok(input.dinnerPeople)) throw domainError('VALIDATION_FAILED', 'Die Anzahl Personen ist ungültig (0 bis 60).');
  const set = { label, closed: input.closed, lunchPeople: input.closed ? 0 : input.lunchPeople, dinnerPeople: input.closed ? 0 : input.dinnerPeople };
  await db.insert(specialDays).values({ site: siteId, workDate: input.date, ...set }).onConflictDoUpdate({ target: [specialDays.site, specialDays.workDate], set });
  await audit(db, p.userId, 'special.save', 'site', siteId, { date: input.date, ...set });
}

export async function deleteSpecialDay(db: AppDatabase, p: Principal, siteId: string, date: string): Promise<void> {
  requirePlanner(p);
  requireSite(siteId);
  await db.delete(specialDays).where(and(eq(specialDays.site, siteId), eq(specialDays.workDate, date)));
  await audit(db, p.userId, 'special.delete', 'site', siteId, { date });
}

// --- Limits for people on holiday at the same time -----------------------------------------------
export interface VacationRuleRow extends VacationRule {
  id: string;
}

export async function listVacationRules(db: AppDatabase, siteId: string): Promise<VacationRuleRow[]> {
  const rows = await db.select().from(vacationRules).where(eq(vacationRules.site, siteId)).orderBy(asc(vacationRules.startDate));
  return rows.map((r) => ({ id: r.id, label: r.label, startDate: r.startDate, endDate: r.endDate, maxPeople: r.maxPeople }));
}

export async function saveVacationRule(db: AppDatabase, p: Principal, siteId: string, input: Omit<VacationRule, never>): Promise<void> {
  requirePlanner(p);
  requireSite(siteId);
  if (!isoDate(input.startDate) || !isoDate(input.endDate) || input.endDate < input.startDate) throw domainError('VALIDATION_FAILED', 'Das Datum ist ungültig.');
  if (!input.label.trim()) throw domainError('VALIDATION_FAILED', 'Bitte einen Namen angeben (z. B. Weihnachtszeit).');
  if (!Number.isInteger(input.maxPeople) || input.maxPeople < 0 || input.maxPeople > 60) throw domainError('VALIDATION_FAILED', 'Die Anzahl Personen ist ungültig (0 bis 60).');
  const [row] = await db.insert(vacationRules).values({ site: siteId, startDate: input.startDate, endDate: input.endDate, label: input.label.trim(), maxPeople: input.maxPeople }).returning({ id: vacationRules.id });
  await audit(db, p.userId, 'vacation.rule', 'vacation_rule', row!.id, { site: siteId, ...input });
}

export async function deleteVacationRule(db: AppDatabase, p: Principal, id: string): Promise<void> {
  requirePlanner(p);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw domainError('NOT_FOUND', 'Rule not found');
  await db.delete(vacationRules).where(eq(vacationRules.id, id));
  await audit(db, p.userId, 'vacation.rule.delete', 'vacation_rule', id);
}

/**
 * Staff cannot request holiday on days where the limit of their site is already reached.
 * (The Leitung can still enter holiday directly.) Throws a message naming the first full day.
 */
export async function assertVacationAllowed(db: AppDatabase, userId: string, startDate: string, endDate: string): Promise<void> {
  const [profile] = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1);
  if (!profile) return;
  for (const siteId of [profile.site, ...profile.extraSites]) {
    const rules = await listVacationRules(db, siteId);
    const relevant = rules.filter((r) => r.startDate <= endDate && r.endDate >= startDate);
    if (relevant.length === 0) continue;
    const mates = (await db.select({ id: staffProfiles.userId, site: staffProfiles.site, extra: staffProfiles.extraSites }).from(staffProfiles)).filter((m) => m.id !== userId && (m.site === siteId || m.extra.includes(siteId)));
    const others = mates.length
      ? await db
          .select()
          .from(absences)
          .where(and(inArray(absences.userId, mates.map((m) => m.id)), eq(absences.type, 'VACATION'), inArray(absences.status, ['APPROVED', 'REQUESTED']), lte(absences.startDate, endDate), gte(absences.endDate, startDate)))
      : [];
    const hit = vacationConflict({ rules: relevant, others, userId, startDate, endDate });
    if (hit) {
      const d = `${hit.date.slice(8)}.${hit.date.slice(5, 7)}.${hit.date.slice(0, 4)}`;
      throw domainError('VALIDATION_FAILED', `Am ${d} (${hit.label}) sind schon ${hit.count} Personen abwesend, erlaubt sind ${hit.max}. Bitte andere Tage wählen oder die Leitung fragen.`);
    }
  }
}
