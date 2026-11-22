'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { ABSENCE_LABEL, ABSENCE_STATUS_LABEL, type AbsenceStatus, type AbsenceType } from '@/domain/roster';
import { formatDay } from '@/lib/dates';
import { absenceStepAction, answerAbsenceAction, requestAbsenceAction } from '../../../actions';
import { useT } from '@/i18n/client';

interface Item {
  id: string;
  startDate: string;
  endDate: string;
  type: AbsenceType;
  status: AbsenceStatus;
  note: string | null;
  decisionNote?: string | null;
  suggestedStart?: string | null;
  suggestedEnd?: string | null;
}

const STATUS_STYLE: Record<AbsenceStatus, string> = {
  REQUESTED: 'bg-warn-50 text-warn-500',
  APPROVED: 'bg-ok-50 text-ok-500',
  REJECTED: 'bg-danger-50 text-danger-500',
};

/** Holiday requests: staff ask, the planner approves. */
export function VacationPanel({ userId, items, today, isPlanner, own = true }: { userId: string; items: Item[]; today: string; isPlanner: boolean; own?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [state, action, pending] = useActionState(requestAbsenceAction, undefined);
  const [removing, start] = useTransition();

  return (
    <section className="space-y-3">
      <h2 className="h-site">{t('Ferien')}</h2>
      <p className="text-sm text-charcoal-muted">{t('Ferien jederzeit anfragen, auch kurzfristig – zum Beispiel weniger als eine Woche im Voraus. Die Leitung bestätigt sie so schnell wie möglich.')}</p>
      <form action={action} className="card grid gap-3 sm:grid-cols-4">
        <input type="hidden" name="userId" value={userId} />
        {isPlanner ? (
          <div>
            <label className="label" htmlFor="type">{t('Art')}</label>
            <select id="type" name="type" className="w-full">
              <option value="VACATION">{t('Ferien')}</option>
              <option value="SICK">{t('Krank')}</option>
              <option value="OTHER">{t('Abwesend')}</option>
            </select>
          </div>
        ) : (
          <input type="hidden" name="type" value="VACATION" />
        )}
        <div>
          <label className="label" htmlFor="startDate">{t('Von')}</label>
          <input id="startDate" name="startDate" type="date" min={isPlanner ? undefined : today} required className="w-full" />
        </div>
        <div>
          <label className="label" htmlFor="endDate">{t('Bis')}</label>
          <input id="endDate" name="endDate" type="date" min={isPlanner ? undefined : today} className="w-full" />
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={pending}>{isPlanner ? t('Eintragen') : t('Anfragen')}</button>
        </div>
        {state?.error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500 sm:col-span-4">{state.error}</p>}
        {state?.saved && <p className="rounded-btn bg-ok-50 p-2 text-sm text-ok-500 sm:col-span-4">{isPlanner ? t('Eingetragen.') : t('Angefragt. Die Leitung bestätigt.')}</p>}
      </form>

      {own && items.filter((a) => a.status === 'REJECTED' && a.endDate >= today).map((a) => <RejectedAnswer key={a.id} item={a} today={today} />)}

      {items.length > 0 && (
        <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <div className="font-medium text-navy">
                  {formatDay(a.startDate, t.lang)}{a.endDate !== a.startDate && ` – ${formatDay(a.endDate, t.lang)}`}
                </div>
                <div className="text-xs text-charcoal-muted">{t(ABSENCE_LABEL[a.type])}{a.note ? ` · ${a.note}` : ''}</div>
                {a.status === 'REJECTED' && a.decisionNote && <div className="text-xs text-danger-500">{t('Grund:')} {a.decisionNote}</div>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`chip ${STATUS_STYLE[a.status]}`}>{t(ABSENCE_STATUS_LABEL[a.status])}</span>
                {(isPlanner || a.status === 'REQUESTED' || (own && a.status === 'REJECTED')) && (
                  <button
                    className="btn-ghost min-h-0 px-2 py-1 text-sm text-brand-600"
                    disabled={removing}
                    onClick={() => start(async () => { await absenceStepAction(a.id, 'cancel'); router.refresh(); })}
                  >
                    {isPlanner ? t('Löschen') : a.status === 'REJECTED' ? t('Entfernen') : t('Zurückziehen')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A "no" from the Leitung: take their suggestion, ask for other days, or drop the holiday. */
function RejectedAnswer({ item: a, today }: { item: Item; today: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [mode, setMode] = useState<'choose' | 'other'>('choose');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const range = (s: string, e: string) => `${formatDay(s, t.lang)}${e !== s ? ` – ${formatDay(e, t.lang)}` : ''}`;
  const run = (answer: Parameters<typeof answerAbsenceAction>[1]) =>
    start(async () => {
      setError(null);
      try {
        const r = await answerAbsenceAction(a.id, answer);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } catch {
        setError(t('Keine Verbindung oder die Seite ist veraltet. Bitte Seite neu laden und nochmals versuchen.'));
      }
    });
  const hasSuggestion = Boolean(a.suggestedStart && a.suggestedEnd && a.suggestedStart >= today);
  return (
    <div role="status" className="space-y-3 rounded-btn border-2 border-brand-600 bg-white p-4">
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-brand-600">{t('Ferienanfrage nicht bewilligt')}</div>
        <div className="font-semibold text-navy">{range(a.startDate, a.endDate)}</div>
        {a.decisionNote && <p className="text-sm text-charcoal">{t('Grund:')} {a.decisionNote}</p>}
      </div>
      {hasSuggestion && (
        <div className="rounded-btn bg-ok-50 p-3 text-sm">
          <div className="text-ok-500">{t('Die Leitung schlägt vor:')}</div>
          <div className="font-semibold text-navy">{range(a.suggestedStart!, a.suggestedEnd!)}</div>
        </div>
      )}
      {mode === 'choose' ? (
        <div className="flex flex-wrap gap-2">
          {hasSuggestion && (
            <button className="btn-primary" disabled={busy} onClick={() => run({ kind: 'accept' })}>{t('Vorschlag annehmen')}</button>
          )}
          <button className={hasSuggestion ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => setMode('other')}>{t('Andere Tage wählen')}</button>
          <button className="btn-secondary" disabled={busy} onClick={() => run({ kind: 'drop' })}>{t('Verzichten')}</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor={`of-${a.id}`}>{t('Von')}</label>
              <input id={`of-${a.id}`} type="date" className="w-full" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor={`ot-${a.id}`}>{t('Bis')}</label>
              <input id={`ot-${a.id}`} type="date" className="w-full" min={from || today} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || !from} onClick={() => run({ kind: 'other', startDate: from, endDate: to || from })}>{t('Neu anfragen')}</button>
            <button className="btn-secondary" disabled={busy} onClick={() => setMode('choose')}>{t('Zurück')}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger-500">{error}</p>}
    </div>
  );
}
