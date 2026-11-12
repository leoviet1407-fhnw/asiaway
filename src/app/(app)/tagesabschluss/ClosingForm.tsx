'use client';

import { useActionState, useMemo, useState } from 'react';
import { DIFFERENCE_LABEL, closingWarnings, computeClosing, differenceTone } from '@/domain/closing';
import { formatChf, parseChfToCents } from '@/domain/qty';
import { saveClosingAction } from '../../actions';

interface Values {
  id?: string;
  locationId: string;
  businessDate: string;
  station: string;
  cashCounted: string;
  startFloat: string;
  eft: string;
  mobile: string;
  posGross: string;
  note: string;
}

interface Props {
  values: Values;
  locations: { id: string; name: string; stations: string[] }[];
  /** Existing closing: location, date and station can no longer change. */
  locked: boolean;
  maxDate: string;
}

const toCents = (v: string) => parseChfToCents(v || '0') ?? 0;

/** The paper form, with every sum calculated as you type. */
export function ClosingForm({ values, locations, locked, maxDate }: Props) {
  const [state, action, pending] = useActionState(saveClosingAction, undefined);
  const [v, setV] = useState(values);
  const set = (key: keyof Values) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [key]: e.target.value }));
  const stations = locations.find((l) => l.id === v.locationId)?.stations ?? [];

  const input = useMemo(
    () => ({
      cashCountedCents: toCents(v.cashCounted),
      startFloatCents: toCents(v.startFloat),
      eftCents: toCents(v.eft),
      mobileCents: toCents(v.mobile),
      posGrossCents: toCents(v.posGross),
    }),
    [v.cashCounted, v.startFloat, v.eft, v.mobile, v.posGross],
  );
  const result = computeClosing(input);
  const warnings = v.cashCounted && v.posGross ? closingWarnings(input) : [];
  const tone = differenceTone(result.differenceCents);
  const toneClass = tone === 'short' ? 'text-brand-600' : tone === 'tips' ? 'text-ok-500' : 'text-navy';

  return (
    <form action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <section className="card grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="locationId">Standort</label>
          {locked ? (
            <>
              <input type="hidden" name="locationId" value={v.locationId} />
              <div className="min-h-tap rounded-btn bg-surface-sunken px-3 py-2">{locations.find((l) => l.id === v.locationId)?.name}</div>
            </>
          ) : (
            <select
              id="locationId"
              name="locationId"
              className="w-full"
              value={v.locationId}
              onChange={(e) => setV((cur) => ({ ...cur, locationId: e.target.value, station: locations.find((l) => l.id === e.target.value)?.stations[0] ?? '' }))}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="label" htmlFor="businessDate">Datum</label>
          <input id="businessDate" name="businessDate" type="date" className="w-full" value={v.businessDate} max={maxDate} onChange={set('businessDate')} readOnly={locked} required />
        </div>
        <div>
          <label className="label" htmlFor="station">Station</label>
          {locked ? (
            <>
              <input type="hidden" name="station" value={v.station} />
              <div className="min-h-tap rounded-btn bg-surface-sunken px-3 py-2">{v.station}</div>
            </>
          ) : (
            <select id="station" name="station" className="w-full" value={v.station} onChange={set('station')}>
              {stations.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      </section>

      <section className="card space-y-3">
        <Money label="Cashbestand (Kassa)" name="cashCounted" value={v.cashCounted} onChange={set('cashCounted')} hint="Bargeld in der Kasse, gezählt" required autoFocus={!locked} />
        <Money label="− Anfangsbestand (Stock)" name="startFloat" value={v.startFloat} onChange={set('startFloat')} />
        <Calc label="= Barumsatz (Cash vom Tag)" value={formatChf(result.cashSalesCents)} />
        <Money label="+ EFT" name="eft" value={v.eft} onChange={set('eft')} hint="Total Kartenterminal" required />
        <Money label="+ Mobile Payment" name="mobile" value={v.mobile} onChange={set('mobile')} hint="z. B. TWINT, leer lassen wenn keine" />
        <Calc label="TOTAL (IST)" value={formatChf(result.totalActualCents)} strong />
      </section>

      <section className="card space-y-3">
        <Money label="Kassen-Brutto laut POS (SOLL)" name="posGross" value={v.posGross} onChange={set('posGross')} hint="Bruttoumsatz aus dem Kassensystem" required />
        <div className="flex items-baseline justify-between gap-3 border-t border-surface-line pt-3">
          <span className="font-semibold text-navy">Differenz / Trinkgeld</span>
          <span className={`text-right text-xl font-bold ${toneClass}`}>
            {formatChf(result.differenceCents)}
            <span className="block text-xs font-semibold">{DIFFERENCE_LABEL[tone]}</span>
          </span>
        </div>
      </section>

      <section className="card">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-semibold text-navy">BANK EINZAHLEN</div>
            <div className="text-xs text-charcoal-muted">Kassen-Brutto − EFT − Mobile</div>
          </div>
          <div className="text-2xl font-bold text-navy">{formatChf(result.bankDepositCents)}</div>
        </div>
      </section>

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-btn bg-warn-50 p-3 text-sm text-warn-500">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <div>
        <label className="label" htmlFor="note">Notiz</label>
        <input id="note" name="note" className="w-full" maxLength={1000} value={v.note} onChange={set('note')} placeholder="optional, z. B. Differenz erklärt durch …" />
      </div>

      {state?.error && <p role="alert" className="rounded-btn bg-danger-50 p-3 text-danger-500">{state.error}</p>}
      <button className="btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? 'Speichert …' : values.id ? 'Änderungen speichern' : 'Abschluss speichern'}
      </button>
    </form>
  );
}

function Money(props: { label: string; name: string; value: string; onChange: (e: { target: { value: string } }) => void; hint?: string; required?: boolean; autoFocus?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3">
      <label htmlFor={props.name} className="min-w-0">
        <span className="block font-medium text-navy">{props.label}</span>
        {props.hint && <span className="block text-xs text-charcoal-muted">{props.hint}</span>}
      </label>
      <div className="flex items-center gap-1">
        <span className="text-sm text-charcoal-muted">CHF</span>
        <input
          id={props.name}
          name={props.name}
          inputMode="decimal"
          className="w-32 text-right text-lg font-semibold"
          value={props.value}
          onChange={props.onChange}
          onFocus={(e) => e.target.select()}
          placeholder="0.00"
          required={props.required}
          autoFocus={props.autoFocus}
        />
      </div>
    </div>
  );
}

function Calc({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-t border-surface-line pt-3 ${strong ? 'font-bold text-navy' : 'text-charcoal'}`}>
      <span className={strong ? '' : 'font-medium'}>{label}</span>
      <span className="text-lg font-bold text-navy">{value}</span>
    </div>
  );
}
