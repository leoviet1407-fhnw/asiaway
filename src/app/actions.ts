'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { DomainError } from '@/domain/errors';
import { parseChfToCents, parseQty } from '@/domain/qty';
import { messageFor } from '@/lib/messages';
import { requirePrincipal } from '@/server/auth/current';
import { SESSION_COOKIE, SESSION_DAYS, login, logout } from '@/server/auth/session';
import { db } from '@/server/db';
import { mailerFromEnv, orderFromAddress } from '@/server/mail/mailer';
import { updateItem, updateSupplier, type StorageArea } from '@/server/services/catalog-service';
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

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: messageFor(error.code, error.message) };
  console.error('[action] unexpected error', error);
  return { ok: false, error: messageFor('INTERNAL_ERROR') };
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
    if (error instanceof DomainError && error.code === 'UNAUTHENTICATED') return { error: 'E-Mail oder Passwort ist falsch.' };
    return { error: fail(error).error };
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
    return { error: fail(error).error };
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
    return fail(error);
  }
}

export async function setLineNoteAction(orderId: string, itemId: string, qty: number, note: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await setLineQty(await db(), p, orderId, itemId, qty, note);
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return fail(error);
  }
}

export async function updateOrderDetailsAction(orderId: string, deliveryDate: string, note: string): Promise<ActionResult> {
  try {
    const p = await requirePrincipal();
    await updateOrderDetails(await db(), p, orderId, { deliveryDate: deliveryDate || null, note: note || null });
    return { ok: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return fail(error);
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
    return fail(error);
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
    return fail(error);
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
    return fail(error);
  }
}

export async function uploadPhotoAction(form: FormData): Promise<ActionResult<string>> {
  try {
    const p = await requirePrincipal();
    const file = form.get('photo');
    if (!(file instanceof File)) return { ok: false, error: 'Kein Foto erhalten.' };
    const kind = form.get('kind') === 'DAMAGE' ? 'DAMAGE' : 'DELIVERY_NOTE';
    const id = await addReceiptPhoto(await db(), p, String(form.get('receiptId')), kind, file.type, Buffer.from(await file.arrayBuffer()));
    return { ok: true, value: id };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return fail(error);
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
    return { error: fail(error).error };
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
      active: form.get('active') === 'on',
      barcodes,
      offers,
    });
    revalidatePath('/artikel', 'layout');
    return { saved: true };
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: fail(error).error };
  }
}

export async function updateSupplierAction(_prev: { error?: string; saved?: boolean } | undefined, form: FormData): Promise<{ error?: string; saved?: boolean }> {
  try {
    const p = await requirePrincipal();
    const minOrder = parseChfToCents(String(form.get('minOrder') ?? '0') || '0');
    if (minOrder === null) return { error: 'Mindestbestellwert ist ungültig.' };
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
    return { error: fail(error).error };
  }
}
