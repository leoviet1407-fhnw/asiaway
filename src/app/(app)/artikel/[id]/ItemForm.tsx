'use client';

import { useActionState, useState } from 'react';
import type { CatalogItem } from '@/server/services/catalog-service';
import { updateItemAction } from '../../../actions';

const AREAS = [
  ['COLD', 'Kühlraum'],
  ['FREEZER', 'Tiefkühler'],
  ['DRY', 'Trockenlager'],
  ['BAR', 'Bar'],
] as const;

export function ItemForm({ item }: { item: CatalogItem }) {
  const [state, action, pending] = useActionState(updateItemAction, undefined);
  const [codes, setCodes] = useState(item.barcodes.length > 0 ? item.barcodes : [{ code: '', unitsPerScan: 1, label: null }]);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={item.id} />
      <section className="card grid gap-3 sm:grid-cols-2">
        <Field label="Name (DE)" name="nameDe" defaultValue={item.nameDe} required />
        <Field label="Name (VI)" name="nameVi" defaultValue={item.nameVi ?? ''} />
        <div>
          <label className="label">Lagerort</label>
          <select name="storageArea" defaultValue={item.storageArea} className="w-full">
            {AREAS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <Field label="Lagereinheit" name="stockUnit" defaultValue={item.stockUnit} />
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Check name="isFresh" label="Frischware (ohne Barcode)" defaultChecked={item.isFresh} />
          <Check name="isKeyItem" label="Key-Artikel (wird gezählt)" defaultChecked={item.isKeyItem} />
          <Check name="active" label="Aktiv" defaultChecked={item.active} />
        </div>
        <p className="text-xs text-charcoal-muted sm:col-span-2">Interne Art.-Nr.: {item.sku}</p>
      </section>

      <section className="card space-y-2">
        <h2 className="text-lg">Barcodes (EAN)</h2>
        <p className="text-xs text-charcoal-muted">„Menge pro Scan“ in Bestelleinheiten: Karton = 1, eine Flasche aus einem 12er-Karton = 0.0833.</p>
        {codes.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input name="barcode" defaultValue={c.code} inputMode="numeric" placeholder="EAN" className="min-w-0 flex-1" aria-label="Barcode" />
            <input name="unitsPerScan" defaultValue={String(c.unitsPerScan)} inputMode="decimal" className="w-24" aria-label="Menge pro Scan" />
          </div>
        ))}
        <button type="button" className="btn-ghost px-0 text-sm" onClick={() => setCodes((all) => [...all, { code: '', unitsPerScan: 1, label: null }])}>
          + Barcode hinzufügen
        </button>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg">Lieferanten & Preise</h2>
        {item.offers.map((o) => (
          <div key={o.supplierItemId} className="grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="offerId" value={o.supplierItemId} />
            <div className="sm:col-span-3 text-sm font-semibold text-navy">{o.supplierName}</div>
            <Field label="Art.-Nr. Lieferant" name="supplierSku" defaultValue={o.supplierSku ?? ''} />
            <Field label="Bestelleinheit" name="orderUnit" defaultValue={o.orderUnit} />
            <Field label="Preis CHF" name="price" defaultValue={(o.priceCents / 100).toFixed(2)} inputMode="decimal" />
          </div>
        ))}
      </section>

      {state?.error && <p className="rounded-btn bg-danger-50 p-3 text-danger-500">{state.error}</p>}
      {state?.saved && <p className="rounded-btn bg-ok-50 p-3 text-ok-500">Gespeichert.</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? 'Speichert …' : 'Speichern'}
      </button>
    </form>
  );
}

function Field(props: { label: string; name: string; defaultValue: string; required?: boolean; inputMode?: 'decimal' | 'numeric' }) {
  return (
    <div>
      <label className="label" htmlFor={`${props.name}-${props.label}`}>
        {props.label}
      </label>
      <input id={`${props.name}-${props.label}`} name={props.name} defaultValue={props.defaultValue} required={props.required} inputMode={props.inputMode} className="w-full" />
    </div>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="min-h-0 accent-brand-600" />
      {label}
    </label>
  );
}
