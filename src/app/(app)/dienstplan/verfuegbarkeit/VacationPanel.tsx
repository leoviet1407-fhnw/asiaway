'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useTransition } from 'react';
import { ABSENCE_LABEL, ABSENCE_STATUS_LABEL, type AbsenceStatus, type AbsenceType } from '@/domain/roster';
import { formatDay } from '@/lib/dates';
import { absenceStepAction, requestAbsenceAction } from '../../../actions';
import { useT } from '@/i18n/client';

interface Item {
  id: string;
  startDate: string;
  endDate: string;
  type: AbsenceType;
  status: AbsenceStatus;
  note: string | null;
}

const STATUS_STYLE: Record<AbsenceStatus, string> = {
  REQUESTED: 'bg-warn-50 text-warn-500',
  APPROVED: 'bg-ok-50 text-ok-500',
  REJECTED: 'bg-danger-50 text-danger-500',
};

/** Holiday requests: staff ask, the planner approves. */
export function VacationPanel({ userId, items, minDate, isPlanner }: { userId: string; items: Item[]; minDate: string; isPlanner: boolean }) {
  const t = useT();
  const router = useRouter();
  const [state, action, pending] = useActionState(requestAbsenceAction, undefined);
  const [removing, start] = useTransition();

  return (
    <section className="space-y-3">
      <h2 className="h-site">{t('Ferien')}</h2>
      <p className="text-sm text-charcoal-muted">{t('Ferien bitte mindestens einen Monat im Voraus anfragen. Die Leitung bestätigt sie.')}</p>
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
          <input id="startDate" name="startDate" type="date" min={isPlanner ? undefined : minDate} required className="w-full" />
        </div>
        <div>
          <label className="label" htmlFor="endDate">{t('Bis')}</label>
          <input id="endDate" name="endDate" type="date" min={isPlanner ? undefined : minDate} className="w-full" />
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={pending}>{isPlanner ? t('Eintragen') : t('Anfragen')}</button>
        </div>
        {state?.error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500 sm:col-span-4">{state.error}</p>}
        {state?.saved && <p className="rounded-btn bg-ok-50 p-2 text-sm text-ok-500 sm:col-span-4">{isPlanner ? t('Eingetragen.') : t('Angefragt. Die Leitung bestätigt.')}</p>}
      </form>

      {items.length > 0 && (
        <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <div className="font-medium text-navy">
                  {formatDay(a.startDate, t.lang)}{a.endDate !== a.startDate && ` – ${formatDay(a.endDate, t.lang)}`}
                </div>
                <div className="text-xs text-charcoal-muted">{t(ABSENCE_LABEL[a.type])}{a.note ? ` · ${a.note}` : ''}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`chip ${STATUS_STYLE[a.status]}`}>{t(ABSENCE_STATUS_LABEL[a.status])}</span>
                {(isPlanner || a.status === 'REQUESTED') && (
                  <button
                    className="btn-ghost min-h-0 px-2 py-1 text-sm text-brand-600"
                    disabled={removing}
                    onClick={() => start(async () => { await absenceStepAction(a.id, 'cancel'); router.refresh(); })}
                  >
                    {isPlanner ? t('Löschen') : t('Zurückziehen')}
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
