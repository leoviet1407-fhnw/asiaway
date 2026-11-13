'use client';

import { useActionState, useState } from 'react';
import { openDraftAction } from '../../../actions';
import { useT } from '@/i18n/client';

export function NewOrderForm({ locations, suppliers }: { locations: { id: string; name: string }[]; suppliers: { id: string; name: string; info: string }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(openDraftAction, undefined);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  if (locations.length === 0) return <p className="card">{t('Ihrem Konto ist kein Standort zugeordnet.')}</p>;
  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className="label">{t('Standort')}</legend>
        <div className="grid gap-2">
          {locations.map((l) => (
            <label key={l.id} className={`card flex cursor-pointer items-center gap-3 py-3 ${locationId === l.id ? 'border-brand-600 ring-1 ring-brand-600' : ''}`}>
              <input type="radio" name="locationId" value={l.id} checked={locationId === l.id} onChange={() => setLocationId(l.id)} className="min-h-0 accent-brand-600" />
              <span className="font-semibold text-navy">{l.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">{t('Lieferant')}</legend>
        <div className="grid gap-2">
          {suppliers.map((s) => (
            <button key={s.id} name="supplierId" value={s.id} disabled={pending} className="card text-left hover:border-brand-600">
              <div className="font-semibold text-navy">{s.name}</div>
              {s.info && <div className="text-sm text-charcoal-muted">{s.info}</div>}
            </button>
          ))}
        </div>
      </fieldset>
      {state?.error && <p className="rounded-btn bg-danger-50 p-3 text-danger-500">{state.error}</p>}
    </form>
  );
}
