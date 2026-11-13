'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatTime, weekdayShort, type Shift } from '@/domain/roster';
import { formatWorked } from '@/domain/hours';
import { confirmShiftAction, correctShiftAction, deleteEntryAction, monthStepAction, saveEntryAction } from '../../../actions';

interface Entry {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  breakMin: number;
  shiftId: string | null;
  note: string | null;
  netMinutes: number;
}

interface Props {
  userId: string;
  month: string;
  today: string;
  planned: (Shift & { entryId: string | null })[];
  entries: Entry[];
  approved: boolean;
  isPlanner: boolean;
  isSelf: boolean;
}

const dm = (iso: string) => `${weekdayShort(iso)} ${iso.slice(8)}.${iso.slice(5, 7)}.`;

/** Confirm the planned shifts, correct them, and add extra hours. */
export function HoursEditor(props: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ start: '', end: '', breakMin: '0', note: '' });
  const [extra, setExtra] = useState({ date: props.today, start: '', end: '', breakMin: '0', note: '' });
  const locked = props.approved;

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

  const entryOf = (shift: Shift & { entryId: string | null }) => props.entries.find((e) => e.id === shift.entryId);
  const extras = props.entries.filter((e) => !e.shiftId);
  const monthOpen = (date: string) => date <= props.today;

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="rounded-btn bg-danger-50 p-3 text-danger-500">{error}</p>}

      <section className="space-y-2">
        <h2 className="h-site">Geplante Schichten</h2>
        {props.planned.length === 0 ? (
          <p className="card text-sm text-charcoal-muted">In diesem Monat gibt es keine veröffentlichten Schichten.</p>
        ) : (
          <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
            {props.planned.map((s) => {
              const e = entryOf(s);
              const open = monthOpen(s.date);
              return (
                <li key={s.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-navy">{dm(s.date)} · {formatTime(s.startMin)}–{formatTime(s.endMin)}</div>
                      <div className="text-xs text-charcoal-muted">{s.roleLabel ?? s.station}</div>
                      {e && (
                        <div className={`text-sm ${e.startMin !== s.startMin || e.endMin !== s.endMin || e.breakMin !== s.breakMin ? 'font-semibold text-brand-600' : 'text-ok-500'}`}>
                          erfasst: {formatTime(e.startMin)}–{formatTime(e.endMin)}{e.breakMin ? `, ${e.breakMin} Min. Pause` : ''} ({formatWorked(e.netMinutes)}){e.note ? ` · ${e.note}` : ''}
                        </div>
                      )}
                    </div>
                    {!locked && open && editing !== s.id && (
                      <div className="flex gap-2">
                        {!e && (
                          <button className="btn-primary min-h-0 px-3 py-1.5 text-sm" disabled={pending} onClick={() => run(() => confirmShiftAction(s.id))}>
                            Wie geplant ✓
                          </button>
                        )}
                        <button
                          className="btn-secondary min-h-0 px-3 py-1.5 text-sm"
                          onClick={() => {
                            setEditing(s.id);
                            setForm({ start: formatTime(e?.startMin ?? s.startMin), end: formatTime(e?.endMin ?? s.endMin), breakMin: String(e?.breakMin ?? s.breakMin), note: e?.note ?? '' });
                          }}
                        >
                          Ändern
                        </button>
                      </div>
                    )}
                    {!open && <span className="text-xs text-charcoal-muted">noch nicht gearbeitet</span>}
                  </div>
                  {editing === s.id && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div><label className="label" htmlFor={`s-${s.id}`}>Beginn</label><input id={`s-${s.id}`} inputMode="numeric" className="w-full" value={form.start} onChange={(ev) => setForm({ ...form, start: ev.target.value })} /></div>
                      <div><label className="label" htmlFor={`e-${s.id}`}>Ende</label><input id={`e-${s.id}`} inputMode="numeric" className="w-full" value={form.end} onChange={(ev) => setForm({ ...form, end: ev.target.value })} /></div>
                      <div><label className="label" htmlFor={`b-${s.id}`}>Pause (Min.)</label><input id={`b-${s.id}`} inputMode="numeric" className="w-full" value={form.breakMin} onChange={(ev) => setForm({ ...form, breakMin: ev.target.value })} /></div>
                      <div className="col-span-3"><input aria-label="Notiz" className="w-full" placeholder="Notiz (z. B. Gäste blieben länger)" value={form.note} onChange={(ev) => setForm({ ...form, note: ev.target.value })} /></div>
                      <div className="col-span-3 flex gap-2">
                        <button className="btn-primary" disabled={pending} onClick={() => run(() => correctShiftAction(s.id, { start: form.start, end: form.end, breakMin: Number(form.breakMin), note: form.note }), () => setEditing(null))}>Speichern</button>
                        <button className="btn-secondary" onClick={() => setEditing(null)}>Abbrechen</button>
                        {e && <button className="btn-danger ml-auto" disabled={pending} onClick={() => run(() => deleteEntryAction(e.id), () => setEditing(null))}>Eintrag löschen</button>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="h-site">Zusätzliche Arbeitszeit</h2>
        {extras.length > 0 && (
          <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
            {extras.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div>
                  <div className="font-semibold text-navy">{dm(e.date)} · {formatTime(e.startMin)}–{formatTime(e.endMin)} ({formatWorked(e.netMinutes)})</div>
                  {e.note && <div className="text-xs text-charcoal-muted">{e.note}</div>}
                </div>
                {!locked && (
                  <button className="btn-ghost min-h-0 px-2 py-1 text-sm text-brand-600" disabled={pending} onClick={() => run(() => deleteEntryAction(e.id))}>
                    Löschen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!locked && (
          <div className="card grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor="x-date">Tag</label><input id="x-date" type="date" className="w-full" value={extra.date} max={props.today} min={`${props.month}-01`} onChange={(ev) => setExtra({ ...extra, date: ev.target.value })} /></div>
            <div><label className="label" htmlFor="x-start">Beginn</label><input id="x-start" inputMode="numeric" className="w-full" placeholder="08:00" value={extra.start} onChange={(ev) => setExtra({ ...extra, start: ev.target.value })} /></div>
            <div><label className="label" htmlFor="x-end">Ende</label><input id="x-end" inputMode="numeric" className="w-full" placeholder="11:00" value={extra.end} onChange={(ev) => setExtra({ ...extra, end: ev.target.value })} /></div>
            <div><label className="label" htmlFor="x-break">Pause (Min.)</label><input id="x-break" inputMode="numeric" className="w-full" value={extra.breakMin} onChange={(ev) => setExtra({ ...extra, breakMin: ev.target.value })} /></div>
            <div className="col-span-2 sm:col-span-5"><input aria-label="Notiz" className="w-full" placeholder="Wofür? (z. B. Inventur, Event)" value={extra.note} onChange={(ev) => setExtra({ ...extra, note: ev.target.value })} /></div>
            <div className="col-span-2 sm:col-span-5">
              <button className="btn-primary" disabled={pending} onClick={() => run(() => saveEntryAction({ userId: props.userId, date: extra.date, start: extra.start, end: extra.end, breakMin: Number(extra.breakMin), note: extra.note }), () => setExtra({ ...extra, start: '', end: '', note: '' }))}>
                Hinzufügen
              </button>
            </div>
          </div>
        )}
      </section>

      {props.isPlanner && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">{locked ? 'Dieser Monat ist freigegeben und gesperrt.' : 'Wenn alles stimmt, den Monat freigeben. Danach zählen die Überstunden.'}</div>
          {locked ? (
            <button className="btn-secondary" disabled={pending} onClick={() => run(() => monthStepAction(props.userId, props.month, 'reopen'))}>Wieder öffnen</button>
          ) : (
            <button className="btn-primary" disabled={pending} onClick={() => run(() => monthStepAction(props.userId, props.month, 'approve'))}>Monat freigeben</button>
          )}
        </section>
      )}
    </div>
  );
}
