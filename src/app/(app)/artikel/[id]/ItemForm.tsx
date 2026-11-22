'use client';

import { useActionState, useState } from 'react';
import type { CatalogItem } from '@/server/services/catalog-service';
import { createItemAction, updateItemAction } from '../../../actions';
import { useT } from '@/i18n/client';
import { Scanner } from '@/components/Scanner';
import { normalizeCode } from '@/domain/ean';

const AREAS = [
  ['COLD', 'Kühlraum'],
  ['FREEZER', 'Tiefkühler'],
  ['DRY', 'Trockenlager'],
  ['BAR', 'Bar'],
] as const;

const EMPTY: CatalogItem = {
  id: '',
  sku: '',
  nameDe: '',
  nameVi: null,
  nameEn: null,
  storageArea: 'DRY',
  stockUnit: 'Stk',
  isFresh: false,
  isKeyItem: false,
  department: null,
  itemGroup: null,
  active: true,
  barcodes: [],
  offers: [],
};

type Supplier = { id: string; name: string };

/** Edit a product, or (without `item`) create a new one with its first supplier. */
export function ItemForm({ item: existing, suppliers, defaultSupplierId }: { item?: CatalogItem; suppliers: Supplier[]; defaultSupplierId?: string }) {
  const t = useT();
  const creating = !existing;
  const item = existing ?? EMPTY;
  const [editState, editAction, editPending] = useActionState(updateItemAction, undefined);
  const [createState, createAction, createPending] = useActionState(createItemAction, undefined);
  const state: { error?: string; saved?: boolean } | undefined = creating ? createState : editState;
  const pending = creating ? createPending : editPending;
  const [codes, setCodes] = useState<{ code: string; units: string }[]>(item.barcodes.length > 0 ? item.barcodes.map((b) => ({ code: b.code, units: String(b.unitsPerScan) })) : [{ code: '', units: '1' }]);
  const [remove, setRemove] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<string | null>(null);
  const setCode = (i: number, patch: Partial<{ code: string; units: string }>) => setCodes((all) => all.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const onScan = (raw: string) => {
    const code = normalizeCode(raw);
    if (!code) return;
    setCodes((all) => {
      if (all.some((c) => c.code === code)) return all;
      const empty = all.findIndex((c) => !c.code);
      return empty >= 0 ? all.map((c, j) => (j === empty ? { ...c, code } : c)) : [...all, { code, units: '1' }];
    });
    setScanned(code);
    setScanning(false);
  };
  const [addOffer, setAddOffer] = useState(creating);
  const offers = item.offers.filter((o) => o.active);
  const otherSuppliers = suppliers.filter((s) => !offers.some((o) => o.supplierId === s.id));
  return (
    <form action={creating ? createAction : editAction} className="space-y-4">
      {!creating && <input type="hidden" name="id" value={item.id} />}
      <section className="card grid gap-3 sm:grid-cols-2">
        <Field label={t('Name (DE)')} name="nameDe" defaultValue={item.nameDe} required />
        <Field label={t('Name (VI)')} name="nameVi" defaultValue={item.nameVi ?? ''} />
        <Field label={t('Name (EN)')} name="nameEn" defaultValue={item.nameEn ?? ''} />
        <div>
          <label className="label">{t('Lagerort')}</label>
          <select name="storageArea" defaultValue={item.storageArea} className="w-full">
            {AREAS.map(([v, l]) => (
              <option key={v} value={v}>
                {t(l)}
              </option>
            ))}
          </select>
        </div>
        <Field label={t('Lagereinheit')} name="stockUnit" defaultValue={item.stockUnit} />
        <Field label={t('Abteilung')} name="department" defaultValue={item.department ?? ''} list="departments" />
        <Field label={t('Gruppe')} name="itemGroup" defaultValue={item.itemGroup ?? ''} list="groups" />
        <datalist id="departments">{['KÜCHE', 'PRODUCTION', 'REINIGUNG', 'BAR'].map((d) => <option key={d} value={d} />)}</datalist>
        <datalist id="groups">{['FOOD', 'GEMÜSE', 'TK PRODUKT', 'GETRÄNKE', 'REINIGUNG'].map((d) => <option key={d} value={d} />)}</datalist>
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Check name="isFresh" label={t('Frischware (ohne Barcode)')} defaultChecked={item.isFresh} />
          <Check name="isKeyItem" label={t('Key-Artikel (wird gezählt)')} defaultChecked={item.isKeyItem} />
          {!creating && <Check name="active" label={t('Aktiv')} defaultChecked={item.active} />}
        </div>
        {creating ? (
          <div className="sm:col-span-2">
            <Field label={t('Interne Art.-Nr. (optional)')} name="sku" defaultValue="" />
            <p className="mt-1 text-xs text-charcoal-muted">{t('Leer lassen: die App vergibt die nächste Nummer (N-1001, N-1002 …).')}</p>
          </div>
        ) : (
          <p className="text-xs text-charcoal-muted sm:col-span-2">{t('Interne Art.-Nr.:')} {item.sku}</p>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="text-lg">{t('Barcodes (EAN)')}</h2>
        <p className="text-xs text-charcoal-muted">{t('„Menge pro Scan“ in Bestelleinheiten: Karton = 1, eine Flasche aus einem 12er-Karton = 0.0833.')}</p>
        {codes.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input name="barcode" value={c.code} onChange={(e) => setCode(i, { code: e.target.value })} inputMode="numeric" placeholder={t('EAN')} className="min-w-0 flex-1" aria-label={t('Barcode')} />
            <input name="unitsPerScan" value={c.units} onChange={(e) => setCode(i, { units: e.target.value })} inputMode="decimal" className="w-24" aria-label={t('Menge pro Scan')} />
            <button type="button" className="btn-secondary min-h-0 px-2.5" aria-label={t('Barcode entfernen')} title={t('Barcode entfernen')} onClick={() => setCodes((all) => (all.length > 1 ? all.filter((_, j) => j !== i) : [{ code: '', units: '1' }]))}>
              ×
            </button>
          </div>
        ))}
        {scanned && <p className="text-xs text-ok-500">{t('Gescannt: {code}', { code: scanned })}</p>}
        {scanning && <Scanner onCode={onScan} />}
        <div className="flex flex-wrap gap-4">
          <button type="button" className="btn-ghost px-0 text-sm" onClick={() => setCodes((all) => [...all, { code: '', units: '1' }])}>
            {t('+ Barcode hinzufügen')}
          </button>
          <button type="button" className="btn-ghost px-0 text-sm" onClick={() => { setScanned(null); setScanning((x) => !x); }}>
            {scanning ? t('Scanner schliessen') : t('📷 Barcode scannen')}
          </button>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg">{t('Lieferanten & Preise')}</h2>
        {offers.map((o) => {
          const removing = remove.includes(o.supplierItemId);
          return (
            <div key={o.supplierItemId} className={`grid gap-2 border-b border-surface-line pb-3 last:border-0 sm:grid-cols-4 ${removing ? 'opacity-50' : ''}`}>
              <input type="hidden" name="offerId" value={o.supplierItemId} />
              <div className="flex items-center justify-between gap-2 sm:col-span-4">
                <span className="text-sm font-semibold text-navy">{o.supplierName}</span>
                <label className="flex items-center gap-1.5 text-sm text-charcoal-muted">
                  <input
                    type="checkbox"
                    name="removeOffer"
                    value={o.supplierItemId}
                    checked={removing}
                    onChange={(e) => setRemove((all) => (e.target.checked ? [...all, o.supplierItemId] : all.filter((x) => x !== o.supplierItemId)))}
                    className="min-h-0 accent-brand-600"
                  />
                  {t('Entfernen')}
                </label>
              </div>
              <Field label={t('Art.-Nr. Lieferant')} name="supplierSku" defaultValue={o.supplierSku ?? ''} />
              <Field label={t('Menge in')} name="quantityUnit" defaultValue={o.quantityUnit ?? ''} />
              <Field label={t('Bestelleinheit')} name="orderUnit" defaultValue={o.orderUnit} />
              <Field label={t('Preis CHF')} name="price" defaultValue={(o.priceCents / 100).toFixed(2)} inputMode="decimal" />
            </div>
          );
        })}
        {remove.length > 0 && <p className="text-xs text-charcoal-muted">{t('Wird beim Speichern entfernt. Frühere Bestellungen bleiben erhalten.')}</p>}

        {addOffer ? (
          <div className="grid gap-2 rounded-btn bg-surface-sunken p-3 sm:grid-cols-4">
            <div className="sm:col-span-4">
              <label className="label" htmlFor="newSupplierId">{creating ? t('Lieferant') : t('Weiterer Lieferant')}</label>
              <select id="newSupplierId" name="newSupplierId" className="w-full" defaultValue={creating ? (defaultSupplierId ?? '') : ''} required={creating}>
                <option value="">{t('– wählen –')}</option>
                {otherSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <Field label={t('Art.-Nr. Lieferant')} name="newSupplierSku" defaultValue="" />
            <Field label={t('Menge in')} name="newQuantityUnit" defaultValue="" list="qtyUnits" />
            <Field label={t('Bestelleinheit')} name="newOrderUnit" defaultValue="" list="orderUnits" required={creating} />
            <Field label={t('Preis CHF')} name="newPrice" defaultValue="" inputMode="decimal" />
            <Field label={t('Stück pro Bestelleinheit')} name="newPackSize" defaultValue="1" inputMode="decimal" />
            <datalist id="qtyUnits">{['kg', 'Karton', 'Stück', 'Liter', 'Pack'].map((d) => <option key={d} value={d} />)}</datalist>
            <datalist id="orderUnits">{['Karton', 'Stk', 'Pack', 'Sack', 'kg', 'Kiste', 'Flasche'].map((d) => <option key={d} value={d} />)}</datalist>
            {!creating && (
              <button type="button" className="btn-ghost px-0 text-left text-sm sm:col-span-4" onClick={() => setAddOffer(false)}>
                {t('Abbrechen')}
              </button>
            )}
          </div>
        ) : (
          otherSuppliers.length > 0 && (
            <button type="button" className="btn-ghost px-0 text-sm" onClick={() => setAddOffer(true)}>
              {t('+ Lieferant hinzufügen')}
            </button>
          )
        )}
      </section>

      {state?.error && <p className="rounded-btn bg-danger-50 p-3 text-danger-500">{state.error}</p>}
      {state?.saved && <p className="rounded-btn bg-ok-50 p-3 text-ok-500">{t('Gespeichert.')}</p>}
      <button className="btn-primary" disabled={pending}>
        {pending ? t('Speichert …') : creating ? t('Artikel anlegen') : t('Speichern')}
      </button>
    </form>
  );
}

function Field(props: { label: string; name: string; defaultValue: string; required?: boolean; inputMode?: 'decimal' | 'numeric'; list?: string }) {
  return (
    <div>
      <label className="label" htmlFor={`${props.name}-${props.label}`}>
        {props.label}
      </label>
      <input id={`${props.name}-${props.label}`} name={props.name} defaultValue={props.defaultValue} required={props.required} inputMode={props.inputMode} list={props.list} className="w-full" />
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
