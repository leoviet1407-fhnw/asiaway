'use client';

import { useActionState } from 'react';
import { updateSupplierAction } from '../../../actions';
import { useT } from '@/i18n/client';

interface SupplierValues {
  id: string;
  name: string;
  orderEmail: string;
  ccEmail: string;
  phone: string;
  orderChannel: string;
  deliveryDays: string;
  cutoffNote: string;
  minOrder: string;
  customerNumber: string;
  notes: string;
  active: boolean;
}

export function SupplierForm({ supplier: s }: { supplier: SupplierValues }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateSupplierAction, undefined);
  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={s.id} />
      <F label={t('Name')} name="name" v={s.name} required />
      <F label={t('Bestell-E-Mail')} name="orderEmail" v={s.orderEmail} type="email" required />
      <F label={t('CC-E-Mail')} name="ccEmail" v={s.ccEmail} type="email" />
      <F label={t('Telefon')} name="phone" v={s.phone} />
      <div>
        <label className="label" htmlFor="orderChannel">
          {t('Bestellweg')}
        </label>
        <select id="orderChannel" name="orderChannel" defaultValue={s.orderChannel} className="w-full">
          <option value="EMAIL">{t('E-Mail')}</option>
          <option value="WHATSAPP">{t('WhatsApp')}</option>
          <option value="PORTAL">{t('Portal')}</option>
        </select>
      </div>
      <F label={t('Liefertage')} name="deliveryDays" v={s.deliveryDays} />
      <F label={t('Bestellschluss')} name="cutoffNote" v={s.cutoffNote} />
      <F label={t('Mindestbestellwert CHF')} name="minOrder" v={s.minOrder} />
      <F label={t('Unsere Kundennummer')} name="customerNumber" v={s.customerNumber} />
      <F label={t('Notizen')} name="notes" v={s.notes} />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={s.active} className="min-h-0 accent-brand-600" /> {t('Aktiv')}
      </label>
      {state?.error && <p className="rounded-btn bg-danger-50 p-3 text-danger-500 sm:col-span-2">{state.error}</p>}
      {state?.saved && <p className="rounded-btn bg-ok-50 p-3 text-ok-500 sm:col-span-2">{t('Gespeichert.')}</p>}
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? t('Speichert …') : t('Speichern')}
        </button>
      </div>
    </form>
  );
}

function F({ label, name, v, type = 'text', required }: { label: string; name: string; v: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input id={name} name={name} defaultValue={v} type={type} required={required} className="w-full" />
    </div>
  );
}
