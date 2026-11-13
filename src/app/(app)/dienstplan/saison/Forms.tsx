'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteSpecialDayAction, deleteVacationRuleAction, saveSpecialDayAction, saveVacationRuleAction } from '../../../actions';
import { useT } from '@/i18n/client';

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Fehler');
      else {
        done?.();
        router.refresh();
      }
    });
  return { pending, error, run };
}

export function SpecialRow({ site, date, dateText, label, closed, lunch, dinner }: { site: string; date: string; dateText: string; label: string; closed: boolean; lunch: number; dinner: number }) {
  const t = useT();
  const { pending, error, run } = useRun();
  return (
    <li className="card flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="font-semibold text-navy">{dateText} · {t(label)}</div>
        <div className="text-sm text-charcoal-muted">{closed ? t('Geschlossen') : `${t('Mittag')} ${lunch} · ${t('Abend')} ${dinner}`}</div>
        {error && <div className="text-sm text-danger-500">{error}</div>}
      </div>
      <button className="btn-ghost min-h-0 px-2 py-1 text-sm text-brand-600" disabled={pending} onClick={() => run(() => deleteSpecialDayAction(site, date))}>{t('Löschen')}</button>
    </li>
  );
}

export function SpecialDayForm({ site, suggestions }: { site: string; suggestions: { date: string; label: string; text: string }[] }) {
  const t = useT();
  const { pending, error, run } = useRun();
  const [f, setF] = useState({ date: '', label: '', closed: false, lunch: '0', dinner: '0' });
  return (
    <div className="card space-y-3">
      <h3 className="text-lg">{t('Tag hinzufügen')}</h3>
      {suggestions.length > 0 && (
        <div>
          <p className="label">{t('Feiertage übernehmen')}</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s.date} type="button" className="chip bg-white px-3 py-1.5 text-charcoal ring-1 ring-surface-line" onClick={() => setF({ ...f, date: s.date, label: s.label })}>{s.text}</button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="sd-date">{t('Datum')}</label><input id="sd-date" type="date" className="w-full" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><label className="label" htmlFor="sd-label">{t('Name')}</label><input id="sd-label" className="w-full" value={f.label} placeholder={t('z. B. Silvester')} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="min-h-0 accent-brand-600" checked={f.closed} onChange={(e) => setF({ ...f, closed: e.target.checked })} /> {t('Geschlossen (niemand wird gebraucht)')}</label>
        {!f.closed && (
          <>
            <div><label className="label" htmlFor="sd-l">{t('Personen Mittag')}</label><input id="sd-l" inputMode="numeric" className="w-full" value={f.lunch} onChange={(e) => setF({ ...f, lunch: e.target.value })} /></div>
            <div><label className="label" htmlFor="sd-d">{t('Personen Abend')}</label><input id="sd-d" inputMode="numeric" className="w-full" value={f.dinner} onChange={(e) => setF({ ...f, dinner: e.target.value })} /></div>
          </>
        )}
      </div>
      {error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">{error}</p>}
      <button className="btn-primary" disabled={pending} onClick={() => run(() => saveSpecialDayAction(site, { date: f.date, label: f.label, closed: f.closed, lunch: Number(f.lunch), dinner: Number(f.dinner) }), () => setF({ date: '', label: '', closed: false, lunch: '0', dinner: '0' }))}>{t('Speichern')}</button>
    </div>
  );
}

export function RuleRow({ id, label, range, max }: { id: string; label: string; range: string; max: number }) {
  const t = useT();
  const { pending, error, run } = useRun();
  return (
    <li className="card flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="font-semibold text-navy">{label}</div>
        <div className="text-sm text-charcoal-muted">{range} · {t('höchstens {n} gleichzeitig', { n: max })}</div>
        {error && <div className="text-sm text-danger-500">{error}</div>}
      </div>
      <button className="btn-ghost min-h-0 px-2 py-1 text-sm text-brand-600" disabled={pending} onClick={() => run(() => deleteVacationRuleAction(id))}>{t('Löschen')}</button>
    </li>
  );
}

export function RuleForm({ site, year }: { site: string; year: number }) {
  const t = useT();
  const { pending, error, run } = useRun();
  const [f, setF] = useState({ label: '', start: '', end: '', max: '2' });
  const preset = (label: string, start: string, end: string) => setF({ ...f, label, start, end });
  return (
    <div className="card space-y-3">
      <h3 className="text-lg">{t('Limite hinzufügen')}</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="chip bg-white px-3 py-1.5 text-charcoal ring-1 ring-surface-line" onClick={() => preset('Weihnachten/Neujahr', `${year}-12-20`, `${year + 1}-01-02`)}>{t('Weihnachten/Neujahr')}</button>
        <button type="button" className="chip bg-white px-3 py-1.5 text-charcoal ring-1 ring-surface-line" onClick={() => preset('Sommerferien', `${year + 1}-07-06`, `${year + 1}-08-16`)}>{t('Sommerferien')}</button>
        <button type="button" className="chip bg-white px-3 py-1.5 text-charcoal ring-1 ring-surface-line" onClick={() => preset('Ostern', `${year + 1}-03-26`, `${year + 1}-04-06`)}>{t('Ostern')}</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2"><label className="label" htmlFor="vr-label">{t('Name')}</label><input id="vr-label" className="w-full" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
        <div><label className="label" htmlFor="vr-from">{t('Von')}</label><input id="vr-from" type="date" className="w-full" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
        <div><label className="label" htmlFor="vr-to">{t('Bis')}</label><input id="vr-to" type="date" className="w-full" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        <div><label className="label" htmlFor="vr-max">{t('Höchstens gleichzeitig')}</label><input id="vr-max" inputMode="numeric" className="w-full" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></div>
      </div>
      {error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">{error}</p>}
      <button className="btn-primary" disabled={pending} onClick={() => run(() => saveVacationRuleAction(site, { label: f.label, startDate: f.start, endDate: f.end, maxPeople: Number(f.max) }), () => setF({ label: '', start: '', end: '', max: '2' }))}>{t('Speichern')}</button>
    </div>
  );
}
