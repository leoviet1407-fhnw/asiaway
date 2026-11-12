'use client';

import { useActionState } from 'react';
import { updateSupplierAction } from '../../../actions';

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
  const [state, action, pending] = useActionState(updateSupplierAction, undefined);
  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={s.id} />
      <F label="Name" name="name" v={s.name} required />
      <F label="Bestell-E-Mail" name="orderEmail" v={s.orderEmail} type="email" required />
      <F label="CC-E-Mail" name="ccEmail" v={s.ccEmail} type="email" />
      <F label="Telefon" name="phone" v={s.phone} />
      <div>
        <label className="label" htmlFor="orderChannel">
          Bestellweg
        </label>
        <select id="orderChannel" name="orderChannel" defaultValue={s.orderChannel} className="w-full">
          <option value="EMAIL">E-Mail</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="PORTAL">Portal</option>
        </select>
      </div>
      <F label="Liefertage" name="deliveryDays" v={s.deliveryDays} />
      <F label="Bestellschluss" name="cutoffNote" v={s.cutoffNote} />
      <F label="Mindestbestellwert CHF" name="minOrder" v={s.minOrder} />
      <F label="Unsere Kundennummer" name="customerNumber" v={s.customerNumber} />
      <F label="Notizen" name="notes" v={s.notes} />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={s.active} className="min-h-0 accent-brand-600" /> Aktiv
      </label>
      {state?.error && <p className="rounded-btn bg-danger-50 p-3 text-danger-500 sm:col-span-2">{state.error}</p>}
      {state?.saved && <p className="rounded-btn bg-ok-50 p-3 text-ok-500 sm:col-span-2">Gespeichert.</p>}
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? 'Speichert …' : 'Speichern'}
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
