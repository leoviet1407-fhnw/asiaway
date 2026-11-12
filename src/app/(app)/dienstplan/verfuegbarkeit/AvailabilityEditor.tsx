'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatTime, isOpenForStaff, weekdayShort, type AvailabilityDay, type AvailabilityKind } from '@/domain/roster';
import { setAvailabilityAction, submitMonthAction } from '../../../actions';

interface Props {
  userId: string;
  month: string;
  dates: string[];
  today: string;
  /** Aushilfen offer the days they can work; everyone else is available unless they say no. */
  onCall: boolean;
  isPlanner: boolean;
  days: AvailabilityDay[];
  /** Dates covered by an approved or requested holiday/absence. */
  absentDates: Record<string, string>;
  submittedAt: string | null;
  isSelf: boolean;
}

interface Cell {
  kind: AvailabilityKind | null;
  from: string;
  to: string;
}

const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;

export function AvailabilityEditor(props: Props) {
  const router = useRouter();
  const [cells, setCells] = useState<Record<string, Cell>>(() =>
    Object.fromEntries(props.days.map((d) => [d.date, { kind: d.kind, from: d.fromMin === null ? '' : formatTime(d.fromMin), to: d.toMin === null ? '' : formatTime(d.toMin) }])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(props.submittedAt !== null);
  const [pending, start] = useTransition();

  const locked = (date: string) => !props.isPlanner && !isOpenForStaff(date, props.today);

  const push = (date: string, cell: Cell) => {
    setCells((c) => ({ ...c, [date]: cell }));
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await setAvailabilityAction({ userId: props.userId, date, kind: cell.kind, from: cell.from, to: cell.to });
      if (!result.ok) {
        setError(result.error);
        router.refresh();
      }
    });
  };

  const setKind = (date: string, kind: AvailabilityKind | null) => push(date, { kind, from: kind === 'AVAILABLE' ? cells[date]?.from ?? '' : '', to: kind === 'AVAILABLE' ? cells[date]?.to ?? '' : '' });

  const fillAll = (kind: AvailabilityKind | null) => {
    for (const d of props.dates) {
      if (locked(d) || props.absentDates[d]) continue;
      if ((cells[d]?.kind ?? null) !== kind) push(d, { kind, from: '', to: '' });
    }
  };

  const open = props.dates.filter((d) => !locked(d));
  const filled = props.dates.filter((d) => cells[d]?.kind).length;

  return (
    <div className="space-y-3">
      {open.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary min-h-0 px-3 py-1.5 text-sm" onClick={() => fillAll('AVAILABLE')}>
            Alle offenen Tage: verfügbar
          </button>
          {!props.onCall && (
            <button type="button" className="btn-secondary min-h-0 px-3 py-1.5 text-sm" onClick={() => fillAll(null)}>
              Alle zurücksetzen
            </button>
          )}
        </div>
      )}
      {props.onCall && <p className="text-sm text-charcoal-muted">Aushilfe: Sie werden nur an Tagen eingeteilt, an denen Sie „verfügbar“ melden.</p>}
      {!props.onCall && <p className="text-sm text-charcoal-muted">Ohne Eintrag sind Sie verfügbar. Tragen Sie nur ein, wenn Sie nicht können.</p>}
      {error && <p role="alert" className="rounded-btn bg-danger-50 p-3 text-danger-500">{error}</p>}

      <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
        {props.dates.map((date) => {
          const cell = cells[date] ?? { kind: null, from: '', to: '' };
          const absence = props.absentDates[date];
          const isLocked = locked(date);
          const weekend = ['Sa', 'So'].includes(weekdayShort(date));
          return (
            <li key={date} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${isLocked ? 'bg-surface-sunken text-charcoal-muted' : ''} ${weekend && !isLocked ? 'bg-brand-50/30' : ''}`}>
              <div className="w-20 shrink-0">
                <span className="font-semibold text-navy">{weekdayShort(date)}</span> {dm(date)}
              </div>
              {absence ? (
                <span className="chip bg-navy text-white">{absence}</span>
              ) : (
                <>
                  <div className="flex gap-1" role="group" aria-label={`Verfügbarkeit ${date}`}>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setKind(date, cell.kind === 'AVAILABLE' ? null : 'AVAILABLE')}
                      className={`btn min-h-0 px-3 py-1.5 text-sm ${cell.kind === 'AVAILABLE' ? 'bg-ok-500 text-white' : 'border border-surface-line bg-white text-navy'}`}
                    >
                      Verfügbar
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setKind(date, cell.kind === 'UNAVAILABLE' ? null : 'UNAVAILABLE')}
                      className={`btn min-h-0 px-3 py-1.5 text-sm ${cell.kind === 'UNAVAILABLE' ? 'bg-brand-600 text-white' : 'border border-surface-line bg-white text-navy'}`}
                    >
                      Nicht verfügbar
                    </button>
                  </div>
                  {cell.kind === 'AVAILABLE' && !isLocked && (
                    <div className="flex items-center gap-1 text-sm">
                      <span className="text-charcoal-muted">nur</span>
                      <input aria-label="von" inputMode="numeric" placeholder="ab" className="w-16 px-2 py-1 text-center" value={cell.from} onChange={(e) => setCells((c) => ({ ...c, [date]: { ...cell, from: e.target.value } }))} onBlur={() => push(date, cells[date]!)} />
                      <span>–</span>
                      <input aria-label="bis" inputMode="numeric" placeholder="bis" className="w-16 px-2 py-1 text-center" value={cell.to} onChange={(e) => setCells((c) => ({ ...c, [date]: { ...cell, to: e.target.value } }))} onBlur={() => push(date, cells[date]!)} />
                    </div>
                  )}
                  {isLocked && <span className="text-xs">gesperrt (weniger als 4 Wochen)</span>}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {props.isSelf && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {filled} Tage eingetragen.
            {saved ? <span className="ml-1 font-semibold text-ok-500">Meldung abgeschickt ✓</span> : <span className="ml-1 text-charcoal-muted">Bitte abschicken, wenn Sie fertig sind.</span>}
          </div>
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await submitMonthAction(props.month);
                if (!result.ok) setError(result.error);
                else {
                  setSaved(true);
                  router.refresh();
                }
              })
            }
          >
            {saved ? 'Nochmals abschicken' : 'Meldung abschicken'}
          </button>
        </div>
      )}
    </div>
  );
}
