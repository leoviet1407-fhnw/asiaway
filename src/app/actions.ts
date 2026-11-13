'use server';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { DomainError } from '@/domain/errors';
import { parseChfToCents, parseQty } from '@/domain/qty';
import { parseTime } from '@/domain/roster';
import { messageFor } from '@/lib/messages';
import { getT } from '@/i18n/server';
import { LANG_COOKIE } from '@/i18n/translate';
import { requirePrincipal } from '@/server/auth/current';
import { SESSION_COOKIE, SESSION_DAYS, changePassword, login, logout } from '@/server/auth/session';
import { db } from '@/server/db';
import { mailerFromEnv, orderFromAddress } from '@/server/mail/mailer';
import { updateItem, updateSupplier, type StorageArea } from '@/server/services/catalog-service';
import {
  approveMonth,
  confirmShift,
  correctShift,
  deleteEntry,
  reopenMonth,
  saveEntry,
  saveYearlyBalance,
} from '@/server/services/hours-service';
import { deriveNeedsFromWeek, saveNeeds } from '@/server/services/coverage-service';
import { applyPattern, fillMissingFromPatterns, savePattern } from '@/server/services/pattern-service';
import { deleteSpecialDay, deleteVacationRule, saveSpecialDay, saveVacationRule } from '@/server/services/season-service';
import { fillGap, publishMonth, suggestMonth, suggestWeek } from '@/server/services/suggest-service';
import { decideChangeRequest, requestChange, withdrawChangeRequest, type ChangeKind } from '@/server/services/change-request-service';
import {
  cancelAbsence,
  copyWeek,
  createStaffUser,
  decideAbsence,
  deleteShift,
  publishWeek,
  requestAbsence,
  saveProfile,
  saveShift,
  setAvailability,
  submitMonth,
  unpublishWeek,
} from '@/server/services/roster-service';
import {
  addClosingPhoto,
  approveClosing,
  reopenClosing,
  saveClosing,
} from '@/server/services/closing-service';
import {
  cancelOrder,
  copyLastOrder,
  openDraft,
  returnToDraft,
  sendOrder,
  setLineQty,
  submitOrder,
  updateOrderDetails,
} from '@/server/services/order-service';
import {
  addReceiptPhoto,
  completeReceipt,
  startReceipt,
  syncReceiptLines,
  type SyncLine,
} from '@/server/services/receiving-service';

export type ActionResult<T = undefined> = { ok: true; value?: T } | { ok: false; error: string };

async function fail(error: unknown): Promise<{ ok: false; error: string }> {
  const t = await getT();
  if (error instanceof DomainError) return { ok: false, error: t(messageFor(error.code, error.message)) };
  console.error('[action] unexpected error', error);
  return { ok: false, error: t(messageFor('INTERNAL_ERROR')) };
}

/** Redirects are thrown by Next; they must pass through untouched. */
function isRedirect(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error && String((error as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');
}

// --- Auth ----------------------------------------------------------------------

export async function loginAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  try {
    const { token } = await login(await db(), email, password);
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/', // not BASE_PATH: a narrower path was not sent back by the browser in testing
      maxAge: SESSION_DAYS * 24 * 3600,
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'UNAUTHENTICATED') return { error: (await getT())('E-Mail oder Passwort ist falsch.') };
    return { error: (await fail(error)).error };
  }
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  await logout(await db(), jar.get(SESSION_COOKIE)?.value);
  jar.delete({ name: SESSION_COOKIE, path: '/' });
  redirect('/login');
}

// --- Orders --------------------------------------------------------------------

export async function openDraftAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  let id: string;
  try {
    const p = await requirePrincipal();
    ({ id } = await openDraft(await db(), p, String(form.get('locationId')), String(form.get('supplierId'))));
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
  redirect(`/bestellungen/${id}`);
}

export async function setQtyAction(orderId: string, itemId: string, qty: number): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await setLineQty(await db(), p, orderId, itemId, qty);
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function setLineNoteAction(orderId: string, itemId: string, qty: number, note: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await setLineQty(await db(), p, orderId, itemId, qty, note);
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function updateOrderDetailsAction(orderId: string, deliveryDate: string, note: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await updateOrderDetails(await db(), p, orderId, { deliveryDate: deliveryDate || null, note: note || null });
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function copyLastOrderAction(orderId: string): Promise<ActionResult<number>> {
  try {
    const p = await requirePrincipal();
    const n = await copyLastOrder(await db(), p, orderId);
    revalidatePath(`/bestellungen/${orderId}`);
    return { ok: true, value: n };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

type OrderStep = 'submit' | 'return' | 'cancel' | 'send';

export async function orderStepAction(orderId: string, step: OrderStep): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    const database = await db();
    if (step === 'submit') await submitOrder(database, p, orderId);
    if (step === 'return') await returnToDraft(database, p, orderId);
    if (step === 'cancel') await cancelOrder(database, p, orderId);
    if (step === 'send') await sendOrder(database, p, orderId, mailerFromEnv(), orderFromAddress());
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

// --- Goods-in ------------------------------------------------------------------

export async function startReceiptAction(form: FormData): Promise<void> {
  const p = await requirePrincipal();
  const { id } = await startReceipt(await db(), p, String(form.get('orderId')));
  redirect(`/wareneingang/${id}`);
}

export async function syncReceiptAction(receiptId: string, lines: SyncLine[]): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await syncReceiptLines(await db(), p, receiptId, lines);
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function uploadPhotoAction(form: FormData): Promise<ActionResult<string>> {
  try {
    const p = await requirePrincipal();
    const file = form.get('photo');
    if (!(file instanceof File)) return { ok: false, error: (await getT())('Kein Foto erhalten.') };
    const kind = form.get('kind') === 'DAMAGE' ? 'DAMAGE' : 'DELIVERY_NOTE';
    const id = await addReceiptPhoto(await db(), p, String(form.get('receiptId')), kind, file.type, Buffer.from(await file.arrayBuffer()));
    return { ok: true, value: id };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function completeReceiptAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const receiptId = String(form.get('receiptId'));
  try {
    const p = await requirePrincipal();
    await completeReceipt(await db(), p, receiptId, {
      closeOrder: form.get('closeOrder') === '1',
      note: String(form.get('note') ?? ''),
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
  revalidatePath('/', 'layout');
  redirect(`/wareneingang/${receiptId}/abweichungen?fertig=1`);
}

// --- Admin -----------------------------------------------------------------------

const AREAS: StorageArea[] = ['COLD', 'FREEZER', 'DRY', 'BAR'];

export async function updateItemAction(_prev: { error?: string; saved?: boolean } | undefined, form: FormData): Promise<{ error?: string; saved?: boolean }> {
  try {
    const p = await requirePrincipal();
    const id = String(form.get('id'));
    const area = String(form.get('storageArea')) as StorageArea;
    const codes = form.getAll('barcode').map(String);
    const units = form.getAll('unitsPerScan').map(String);
    const barcodes = codes
      .map((code, i) => ({ code: code.trim(), unitsPerScan: parseQty(units[i] ?? '1') ?? 0 }))
      .filter((b) => b.code !== '');
    const offerIds = form.getAll('offerId').map(String);
    const offers = offerIds.map((supplierItemId, i) => {
      const cents = parseChfToCents(String(form.getAll('price')[i] ?? ''));
      if (cents === null) throw new DomainError('VALIDATION_FAILED', 'Preis ist ungültig');
      return {
        supplierItemId,
        priceCents: cents,
        orderUnit: String(form.getAll('orderUnit')[i] ?? ''),
        quantityUnit: String(form.getAll('quantityUnit')[i] ?? '') || null,
        supplierSku: String(form.getAll('supplierSku')[i] ?? '') || null,
      };
    });
    await updateItem(await db(), p, id, {
      nameDe: String(form.get('nameDe') ?? ''),
      nameVi: String(form.get('nameVi') ?? '') || null,
      storageArea: AREAS.includes(area) ? area : 'DRY',
      stockUnit: String(form.get('stockUnit') ?? ''),
      isFresh: form.get('isFresh') === 'on',
      isKeyItem: form.get('isKeyItem') === 'on',
      department: String(form.get('department') ?? '') || null,
      itemGroup: String(form.get('itemGroup') ?? '') || null,
      active: form.get('active') === 'on',
      barcodes,
      offers,
    });
    revalidatePath('/artikel', 'layout');
    return { saved: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
}

export async function updateSupplierAction(_prev: { error?: string; saved?: boolean } | undefined, form: FormData): Promise<{ error?: string; saved?: boolean }> {
  try {
    const p = await requirePrincipal();
    const minOrder = parseChfToCents(String(form.get('minOrder') ?? '0') || '0');
    if (minOrder === null) return { error: (await getT())('Mindestbestellwert ist ungültig.') };
    const channel = String(form.get('orderChannel'));
    await updateSupplier(await db(), p, String(form.get('id')), {
      name: String(form.get('name') ?? ''),
      orderEmail: String(form.get('orderEmail') ?? ''),
      ccEmail: String(form.get('ccEmail') ?? '') || null,
      phone: String(form.get('phone') ?? '') || null,
      orderChannel: channel === 'WHATSAPP' || channel === 'PORTAL' ? channel : 'EMAIL',
      deliveryDays: String(form.get('deliveryDays') ?? ''),
      cutoffNote: String(form.get('cutoffNote') ?? '') || null,
      minOrderCents: minOrder,
      customerNumber: String(form.get('customerNumber') ?? '') || null,
      notes: String(form.get('notes') ?? '') || null,
      active: form.get('active') === 'on',
    });
    revalidatePath('/lieferanten', 'layout');
    return { saved: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
}

// --- Daily closing (Tagesabschluss) -------------------------------------------------

function cents(form: FormData, name: string): number {
  const value = parseChfToCents(String(form.get(name) ?? '0') || '0');
  if (value === null) throw new DomainError('VALIDATION_FAILED', 'Ein Betrag ist ungültig.');
  return value;
}

export async function saveClosingAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  let id: string;
  try {
    const p = await requirePrincipal();
    id = await saveClosing(await db(), p, {
      id: String(form.get('id') ?? '') || undefined,
      locationId: String(form.get('locationId') ?? ''),
      businessDate: String(form.get('businessDate') ?? ''),
      station: String(form.get('station') ?? ''),
      cashCountedCents: cents(form, 'cashCounted'),
      startFloatCents: cents(form, 'startFloat'),
      eftCents: cents(form, 'eft'),
      mobileCents: cents(form, 'mobile'),
      posGrossCents: cents(form, 'posGross'),
      note: String(form.get('note') ?? '') || null,
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
  revalidatePath('/tagesabschluss', 'layout');
  redirect(`/tagesabschluss/${id}?gespeichert=1`);
}

export async function closingStepAction(closingId: string, step: 'approve' | 'reopen'): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    if (step === 'approve') await approveClosing(await db(), p, closingId);
    else await reopenClosing(await db(), p, closingId);
    revalidatePath('/tagesabschluss', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function uploadClosingPhotoAction(form: FormData): Promise<ActionResult<string>> {
  try {
    const p = await requirePrincipal();
    const file = form.get('photo');
    if (!(file instanceof File)) return { ok: false, error: (await getT())('Kein Foto erhalten.') };
    const id = await addClosingPhoto(await db(), p, String(form.get('closingId')), file.type, Buffer.from(await file.arrayBuffer()));
    return { ok: true, value: id };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

// --- Dienstplan (staff roster) -------------------------------------------------------------

export async function saveShiftAction(input: {
  id?: string;
  site: string;
  date: string;
  userId: string | null;
  start: string;
  end: string;
  breakMin: number;
  station: string;
  roleLabel: string;
}): Promise<ActionResult<string>> {
  try {
    const p = await requirePrincipal();
    const startMin = parseTime(input.start);
    const endMin = parseTime(input.end);
    if (startMin === null || endMin === null) return { ok: false, error: (await getT())('Zeit ist ungültig (z. B. 10:30).') };
    const id = await saveShift(await db(), p, {
      id: input.id,
      site: input.site,
      date: input.date,
      userId: input.userId || null,
      startMin,
      endMin,
      breakMin: Math.max(0, Math.round(Number(input.breakMin) || 0)),
      station: input.station,
      roleLabel: input.roleLabel || null,
    });
    return { ok: true, value: id };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function deleteShiftAction(shiftId: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await deleteShift(await db(), p, shiftId);
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function weekStepAction(site: string, weekStart: string, step: 'publish' | 'unpublish' | 'copy'): Promise<ActionResult<number>> {
  try {
    const p = await requirePrincipal();
    const database = await db();
    let value = 0;
    if (step === 'publish') await publishWeek(database, p, site, weekStart);
    if (step === 'unpublish') await unpublishWeek(database, p, site, weekStart);
    if (step === 'copy') value = await copyWeek(database, p, site, weekStart);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true, value };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function setAvailabilityAction(input: { userId: string; date: string; kind: 'AVAILABLE' | 'UNAVAILABLE' | null; from: string; to: string }): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    const from = input.from ? parseTime(input.from) : null;
    const to = input.to ? parseTime(input.to) : null;
    if ((input.from && from === null) || (input.to && to === null)) return { ok: false, error: (await getT())('Zeit ist ungültig (z. B. 17:00).') };
    await setAvailability(await db(), p, { userId: input.userId, date: input.date, kind: input.kind, fromMin: from, toMin: to });
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function submitMonthAction(month: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await submitMonth(await db(), p, month);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function requestAbsenceAction(_prev: { error?: string; saved?: boolean } | undefined, form: FormData): Promise<{ error?: string; saved?: boolean }> {
  try {
    const p = await requirePrincipal();
    const type = String(form.get('type') ?? 'VACATION');
    await requestAbsence(await db(), p, {
      userId: String(form.get('userId') || p.userId),
      startDate: String(form.get('startDate') ?? ''),
      endDate: String(form.get('endDate') ?? '') || String(form.get('startDate') ?? ''),
      type: type === 'SICK' || type === 'OTHER' ? type : 'VACATION',
      note: String(form.get('note') ?? '') || null,
    });
    revalidatePath('/dienstplan', 'layout');
    return { saved: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
}

export async function absenceStepAction(absenceId: string, step: 'approve' | 'reject' | 'cancel'): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    const database = await db();
    if (step === 'cancel') await cancelAbsence(database, p, absenceId);
    else await decideAbsence(database, p, absenceId, step === 'approve');
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

function profileFrom(form: FormData) {
  const type = String(form.get('employmentType') ?? 'PART_TIME');
  const employmentType = (['FULL_TIME', 'PART_TIME', 'ON_CALL', 'MANAGEMENT'] as const).find((t) => t === type) ?? 'PART_TIME';
  const pensum = Number(String(form.get('pensum') ?? '').replace('%', '').trim());
  return {
    site: String(form.get('site') ?? ''),
    extraSites: form.getAll('extraSite').map(String).filter(Boolean),
    usualStation: String(form.get('usualStation') ?? '') || null,
    usualFromMin: parseTime(String(form.get('usualFrom') ?? '')),
    usualToMin: parseTime(String(form.get('usualTo') ?? '')),
    phone: String(form.get('phone') ?? '').trim() || null,
    employmentType,
    pensumPercent: Number.isFinite(pensum) && pensum > 0 ? pensum : null,
    active: form.get('active') === 'on',
  };
}

export async function saveProfileAction(_prev: { error?: string; saved?: boolean } | undefined, form: FormData): Promise<{ error?: string; saved?: boolean }> {
  try {
    const p = await requirePrincipal();
    await saveProfile(await db(), p, String(form.get('userId')), profileFrom(form));
    revalidatePath('/dienstplan', 'layout');
    return { saved: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
}

export async function createStaffAction(_prev: { error?: string; password?: string; email?: string } | undefined, form: FormData): Promise<{ error?: string; password?: string; email?: string }> {
  try {
    const p = await requirePrincipal();
    const password = randomBytes(9).toString('base64url');
    const email = String(form.get('email') ?? '').trim();
    await createStaffUser(await db(), p, { ...profileFrom(form), active: true, name: String(form.get('name') ?? ''), email, password });
    revalidatePath('/dienstplan', 'layout');
    return { password, email };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
}

export async function changePasswordAction(_prev: { error?: string; saved?: boolean } | undefined, form: FormData): Promise<{ error?: string; saved?: boolean }> {
  try {
    const p = await requirePrincipal();
    const next = String(form.get('next') ?? '');
    if (next !== String(form.get('repeat') ?? '')) return { error: (await getT())('Die beiden neuen Passwörter sind nicht gleich.') };
    await changePassword(await db(), p.userId, String(form.get('current') ?? ''), next, (await cookies()).get(SESSION_COOKIE)?.value);
    return { saved: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    if (error instanceof DomainError && error.code === 'UNAUTHENTICATED') return { error: (await getT())('Das aktuelle Passwort ist falsch.') };
    return { error: (await fail(error)).error };
  }
}

// --- Hours, overtime, vacation balance ------------------------------------------------------

type TimesInput = { start: string; end: string; breakMin: number; note: string };

function times(input: TimesInput): { startMin: number; endMin: number; breakMin: number; note: string | null } | string {
  const startMin = parseTime(input.start);
  const endMin = parseTime(input.end);
  if (startMin === null || endMin === null) return 'Zeit ist ungültig (z. B. 10:30).';
  return { startMin, endMin, breakMin: Math.max(0, Math.round(Number(input.breakMin) || 0)), note: input.note || null };
}

export async function confirmShiftAction(shiftId: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await confirmShift(await db(), p, shiftId);
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function correctShiftAction(shiftId: string, input: TimesInput): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    const t = times(input);
    if (typeof t === 'string') return { ok: false, error: (await getT())(t) };
    await correctShift(await db(), p, shiftId, t);
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function saveEntryAction(input: TimesInput & { userId: string; date: string; id?: string }): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    const t = times(input);
    if (typeof t === 'string') return { ok: false, error: (await getT())(t) };
    await saveEntry(await db(), p, { id: input.id, userId: input.userId, date: input.date, ...t });
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function deleteEntryAction(entryId: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await deleteEntry(await db(), p, entryId);
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function monthStepAction(userId: string, month: string, step: 'approve' | 'reopen'): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    if (step === 'approve') await approveMonth(await db(), p, userId, month);
    else await reopenMonth(await db(), p, userId, month);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function saveBalanceAction(_prev: { error?: string; saved?: boolean } | undefined, form: FormData): Promise<{ error?: string; saved?: boolean }> {
  try {
    const p = await requirePrincipal();
    const num = (name: string) => Number(String(form.get(name) ?? '0').replace(',', '.')) || 0;
    await saveYearlyBalance(await db(), p, String(form.get('userId')), Number(form.get('year')), {
      vacationDays: num('vacationDays'),
      vacationCarry: num('vacationCarry'),
      overtimeCarryMin: Math.round(num('overtimeCarryHours') * 60),
    });
    revalidatePath('/dienstplan', 'layout');
    return { saved: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: (await fail(error)).error };
  }
}

export async function setLanguageAction(lang: 'de' | 'en'): Promise<void> {
  (await cookies()).set(LANG_COOKIE, lang === 'en' ? 'en' : 'de', { path: '/', maxAge: 365 * 24 * 3600, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}

// --- Staffing need and coverage ---------------------------------------------------------------

export async function saveNeedsAction(site: string, needs: { lunchPeople: number; dinnerPeople: number }[]): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await saveNeeds(await db(), p, site, needs);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function deriveNeedsAction(site: string, weekStart: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await deriveNeedsFromWeek(await db(), p, site, weekStart);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

// --- Change requests: staff ask, the Leitung decides ----------------------------------------
export async function requestChangeAction(input: { kind: ChangeKind; shiftId?: string; date?: string; start?: string; end?: string; breakMin?: number; reason: string }): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    const t = await getT();
    let startMin: number | null = null;
    let endMin: number | null = null;
    if (input.kind !== 'SHIFT_CANCEL') {
      startMin = parseTime(input.start ?? '');
      endMin = parseTime(input.end ?? '');
      if (startMin === null || endMin === null) return { ok: false, error: t('Bitte Zeiten wie 08:00 eingeben.') };
    }
    await requestChange(await db(), p, { kind: input.kind, shiftId: input.shiftId ?? null, date: input.date ?? null, startMin, endMin, breakMin: Number.isFinite(input.breakMin) ? input.breakMin ?? 0 : 0, reason: input.reason });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function decideChangeAction(id: string, approve: boolean): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await decideChangeRequest(await db(), p, id, approve);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function withdrawChangeAction(id: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await withdrawChangeRequest(await db(), p, id);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

// --- Standardwoche, special days, holiday limits, roster suggestion --------------------------------
interface PatternInput {
  weekday: number;
  mode: '' | 'ALL' | 'WINDOW' | 'NO';
  from?: string;
  to?: string;
}

export async function savePatternAction(userId: string, days: PatternInput[]): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    const t = await getT();
    const list = [];
    for (const d of days) {
      if (d.mode === 'WINDOW') {
        const fromMin = parseTime(d.from ?? '');
        const toMin = parseTime(d.to ?? '');
        if (fromMin === null || toMin === null) return { ok: false, error: t('Zeit ist ungültig (z. B. 10:30).') };
        list.push({ weekday: d.weekday, kind: 'AVAILABLE' as const, fromMin, toMin });
      } else if (d.mode === 'ALL') list.push({ weekday: d.weekday, kind: 'AVAILABLE' as const, fromMin: null, toMin: null });
      else if (d.mode === 'NO') list.push({ weekday: d.weekday, kind: 'UNAVAILABLE' as const, fromMin: null, toMin: null });
      else list.push({ weekday: d.weekday, kind: null, fromMin: null, toMin: null });
    }
    await savePattern(await db(), p, userId, list);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function applyPatternAction(userId: string, month: string): Promise<ActionResult & { days?: number }> {
  try {
    const p = await requirePrincipal();
    const n = await applyPattern(await db(), p, userId, month);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true, days: n };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function fillMissingAction(siteId: string, month: string): Promise<ActionResult & { people?: number; days?: number }> {
  try {
    const p = await requirePrincipal();
    const r = await fillMissingFromPatterns(await db(), p, siteId, month);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true, ...r };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function saveSpecialDayAction(siteId: string, input: { date: string; label: string; closed: boolean; lunch: number; dinner: number }): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await saveSpecialDay(await db(), p, siteId, { date: input.date, label: input.label, closed: input.closed, lunchPeople: Math.round(Number(input.lunch) || 0), dinnerPeople: Math.round(Number(input.dinner) || 0) });
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function deleteSpecialDayAction(siteId: string, date: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await deleteSpecialDay(await db(), p, siteId, date);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function saveVacationRuleAction(siteId: string, input: { label: string; startDate: string; endDate: string; maxPeople: number }): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await saveVacationRule(await db(), p, siteId, { label: input.label, startDate: input.startDate, endDate: input.endDate || input.startDate, maxPeople: Math.round(Number(input.maxPeople)) });
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function deleteVacationRuleAction(id: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await deleteVacationRule(await db(), p, id);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function suggestWeekAction(siteId: string, weekStart: string): Promise<ActionResult & { created?: number; gaps?: { date: string; service: 'LUNCH' | 'DINNER'; missing: number }[] }> {
  try {
    const p = await requirePrincipal();
    const r = await suggestWeek(await db(), p, siteId, weekStart);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true, created: r.created, gaps: r.gaps };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function suggestMonthAction(siteId: string, month: string): Promise<ActionResult & { created?: number; weeks?: number; gaps?: number; skipped?: number }> {
  try {
    const p = await requirePrincipal();
    const r = await suggestMonth(await db(), p, siteId, month);
    revalidatePath('/dienstplan', 'layout');
    const done = r.weeks.filter((w) => !w.skipped);
    return { ok: true, created: done.reduce((n, w) => n + w.created, 0), weeks: done.length, gaps: done.reduce((n, w) => n + w.gaps.length, 0), skipped: r.weeks.length - done.length };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function publishMonthAction(siteId: string, month: string): Promise<ActionResult & { published?: number; blocked?: { weekStart: string; errors: number }[] }> {
  try {
    const p = await requirePrincipal();
    const r = await publishMonth(await db(), p, siteId, month);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true, published: r.published.length, blocked: r.blocked };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}

export async function fillGapAction(siteId: string, date: string, service: 'LUNCH' | 'DINNER', userId: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await fillGap(await db(), p, siteId, date, service, userId);
    revalidatePath('/dienstplan', 'layout');
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return await fail(error);
  }
}
