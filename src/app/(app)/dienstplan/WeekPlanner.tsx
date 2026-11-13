'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  EMPLOYMENT_LABEL,
  SHIFT_PRESETS,
  formatHours,
  formatTime,
  personWeekMinutes,
  stationsOf,
  weekDates,
  weekdayShort,
  weeklyTargetCorridor,
  type Absence,
  type AvailabilityDay,
  type RosterPerson,
  type Shift,
  type Violation,
} from '@/domain/roster';
import { deleteShiftAction, publishMonthAction, saveShiftAction, suggestMonthAction, suggestWeekAction, weekStepAction } from '../../actions';
import { useT } from '@/i18n/client';

interface Props {
  site: string;
  weekStart: string;
  status: 'DRAFT' | 'PUBLISHED';
  people: RosterPerson[];
  shifts: Shift[];
  availability: AvailabilityDay[];
  absences: Absence[];
  violations: Violation[];
  editable: boolean;
}

interface Editing {
  id?: string;
  userId: string | null;
  date: string;
  start: string;
  end: string;
  breakMin: string;
  station: string;
  roleLabel: string;
}

const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;

/** The week: a row per person, a column per day. The planner clicks a cell to add or change a shift. */
export function WeekPlanner(props: Props) {
  const t = useT();
  const router = useRouter();
  const stations = stationsOf(props.site);
  const dates = weekDates(props.weekStart);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const colorOf = (station: string) => stations.find((s) => s.name === station);
  const absenceOn = (userId: string, date: string) => props.absences.find((a) => a.userId === userId && a.startDate <= date && date <= a.endDate);
  const availOn = (userId: string, date: string) => props.availability.find((a) => a.userId === userId && a.date === date);
  const open = props.shifts.filter((s) => s.userId === null);

  const blank = (userId: string | null, date: string): Editing => ({ userId, date, start: '10:30', end: '14:30', breakMin: '0', station: stations[0]?.name ?? '', roleLabel: '' });
  const edit = (s: Shift): Editing => ({ id: s.id, userId: s.userId, date: s.date, start: formatTime(s.startMin), end: formatTime(s.endMin), breakMin: String(s.breakMin), station: s.station, roleLabel: s.roleLabel ?? '' });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error ?? t('Fehler'));
      else {
        done?.();
        router.refresh();
      }
    });

  const save = () => {
    if (!editing) return;
    run(
      () => saveShiftAction({ id: editing.id, site: props.site, date: editing.date, userId: editing.userId, start: editing.start, end: editing.end, breakMin: Number(editing.breakMin) || 0, station: editing.station, roleLabel: editing.roleLabel }),
      () => setEditing(null),
    );
  };

  const byDay = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of props.shifts) m.set(`${s.userId ?? 'open'}|${s.date}`, [...(m.get(`${s.userId ?? 'open'}|${s.date}`) ?? []), s]);
    for (const list of m.values()) list.sort((a, b) => a.startMin - b.startMin);
    return m;
  }, [props.shifts]);

  const errors = props.violations.filter((v) => v.severity === 'error');
  const warnings = props.violations.filter((v) => v.severity !== 'error');

  const chip = (s: Shift) => {
    const st = colorOf(s.station);
    return (
      <button
        key={s.id}
        type="button"
        disabled={!props.editable}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(edit(s));
        }}
        className="block w-full rounded px-1 py-0.5 text-left text-[11px] font-semibold leading-tight"
        style={{ background: st?.color ?? '#e3e1df', color: st?.textColor ?? '#09141d' }}
        title={`${s.station}${s.roleLabel ? ` · ${s.roleLabel}` : ''}`}
      >
        {formatTime(s.startMin)}–{formatTime(s.endMin)}
        <span className="block font-normal opacity-80">{s.roleLabel ?? s.station}</span>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {props.editable && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${props.status === 'PUBLISHED' ? 'bg-ok-50 text-ok-500' : 'bg-warn-50 text-warn-500'}`}>{props.status === 'PUBLISHED' ? t('Veröffentlicht') : t('Entwurf – Mitarbeiter sehen noch nichts')}</span>
          <button className="btn-secondary min-h-0 px-3 py-1.5 text-sm" disabled={pending || props.shifts.length > 0} onClick={() => run(() => weekStepAction(props.site, props.weekStart, 'copy'), () => setNotice(t('Letzte Woche übernommen.')))}>
            {t('Letzte Woche kopieren')}
          </button>
          <button
            className="btn-secondary min-h-0 px-3 py-1.5 text-sm"
            disabled={pending || props.shifts.length > 0}
            title={props.shifts.length > 0 ? t('Nur für eine leere Woche') : undefined}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await suggestWeekAction(props.site, props.weekStart);
                if (!r.ok) return setError(r.error);
                const gaps = r.gaps ?? [];
                const names = gaps.map((g) => `${weekdayShort(g.date, t.lang)} ${g.service === 'LUNCH' ? t('Mittag') : t('Abend')} (${g.missing})`).join(', ');
                setNotice(t('Vorschlag: {n} Schichten eingetragen. Bitte prüfen und anpassen.', { n: r.created ?? 0 }) + (gaps.length ? ` ${t('Lücken')}: ${names}.` : ''));
                router.refresh();
              })
            }
          >
            {t('Plan vorschlagen')}
          </button>
          <button
            className="btn-secondary min-h-0 px-3 py-1.5 text-sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await suggestMonthAction(props.site, props.weekStart.slice(0, 7));
                if (!r.ok) return setError(r.error);
                setNotice(t('Monat vorgeschlagen: {n} Schichten in {w} Wochen.', { n: r.created ?? 0, w: r.weeks ?? 0 }) + ((r.gaps ?? 0) > 0 ? ` ${t('{n} Lücken, siehe unten.', { n: r.gaps ?? 0 })}` : '') + ((r.skipped ?? 0) > 0 ? ` ${t('{n} Wochen übersprungen (schon geplant oder vorbei).', { n: r.skipped ?? 0 })}` : ''));
                router.refresh();
              })
            }
          >
            {t('Monat vorschlagen')}
          </button>
          <button
            className="btn-secondary min-h-0 px-3 py-1.5 text-sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await publishMonthAction(props.site, props.weekStart.slice(0, 7));
                if (!r.ok) return setError(r.error);
                const blocked = r.blocked ?? [];
                setNotice(t('{n} Wochen veröffentlicht.', { n: r.published ?? 0 }) + (blocked.length ? ` ${t('Nicht veröffentlicht wegen Fehlern: Woche ab')} ${blocked.map((b) => `${b.weekStart.slice(8)}.${b.weekStart.slice(5, 7)}.`).join(', ')}.` : ''));
                router.refresh();
              })
            }
          >
            {t('Monat veröffentlichen')}
          </button>
          {props.status === 'PUBLISHED' ? (
            <button className="btn-secondary min-h-0 px-3 py-1.5 text-sm" disabled={pending} onClick={() => run(() => weekStepAction(props.site, props.weekStart, 'unpublish'))}>
              {t('Zurück zum Entwurf')}
            </button>
          ) : (
            <button className="btn-primary min-h-0 px-4 py-1.5" disabled={pending} onClick={() => run(() => weekStepAction(props.site, props.weekStart, 'publish'), () => setNotice(t('Veröffentlicht.')))}>
              {t('Veröffentlichen')}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="rounded-btn bg-danger-50 p-3 text-danger-500">{error}</p>}
      {notice && <p className="rounded-btn bg-ok-50 p-3 text-ok-500">{notice}</p>}

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-28 bg-surface-sunken p-1 text-left text-xs">{t('Mitarbeiter')}</th>
              {dates.map((d) => (
                <th key={d} className="p-1 text-center text-xs font-semibold text-navy">
                  {weekdayShort(d, t.lang)} {dm(d)}
                </th>
              ))}
              <th className="p-1 text-right text-xs">{t('Stunden')}</th>
            </tr>
          </thead>
          <tbody>
            {props.people.map((person) => {
              const minutes = personWeekMinutes(props.shifts, person.userId);
              const target = person.pensumPercent ? weeklyTargetCorridor(person.pensumPercent) : null;
              const off = target && (minutes < target.minMin || minutes > target.maxMin);
              return (
                <tr key={person.userId}>
                  <td className="sticky left-0 z-10 border-t border-surface-line bg-surface-sunken p-1 align-top">
                    <div className="font-semibold text-navy">{person.name}</div>
                    <div className="text-[11px] text-charcoal-muted">{person.pensumPercent ? `${person.pensumPercent} %` : t(EMPLOYMENT_LABEL[person.employmentType])}</div>
                  </td>
                  {dates.map((d) => {
                    const absence = absenceOn(person.userId, d);
                    const av = availOn(person.userId, d);
                    const list = byDay.get(`${person.userId}|${d}`) ?? [];
                    return (
                      <td
                        key={d}
                        onClick={() => props.editable && setEditing(blank(person.userId, d))}
                        className={`border-l border-t border-surface-line p-0.5 align-top ${props.editable ? 'cursor-pointer hover:bg-brand-50/40' : ''} ${absence ? 'bg-surface-line/70' : ''}`}
                      >
                        <div className="min-h-[34px] space-y-0.5">
                          {absence && <div className="rounded bg-navy/80 px-1 text-[10px] font-semibold text-white">{absence.type === 'VACATION' ? t('Ferien') : absence.type === 'SICK' ? t('Krank') : t('Abwesend')}</div>}
                          {list.map(chip)}
                          {props.editable && !absence && list.length === 0 && av?.kind === 'UNAVAILABLE' && <div className="text-[10px] text-brand-600">{t('nicht verfügbar')}</div>}
                          {props.editable && !absence && list.length === 0 && av?.kind === 'AVAILABLE' && (
                            <div className="text-[10px] text-ok-500">{av.fromMin !== null ? `${formatTime(av.fromMin)}–${formatTime(av.toMin!)}` : t('verfügbar')}</div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className={`border-l border-t border-surface-line p-1 text-right align-top text-xs ${off ? 'font-bold text-brand-600' : ''}`}>
                    {formatHours(minutes)}
                    {target && <div className="font-normal text-charcoal-muted">{t('Ziel')} {formatHours(target.minMin)}–{formatHours(target.maxMin)}</div>}
                  </td>
                </tr>
              );
            })}
            {(open.length > 0 || props.editable) && (
              <tr>
                <td className="sticky left-0 z-10 border-t border-surface-line bg-surface-sunken p-1 align-top text-brand-600">
                  <div className="font-semibold">{t('Offen')}</div>
                  <div className="text-[11px]">{t('ohne Person')}</div>
                </td>
                {dates.map((d) => (
                  <td key={d} onClick={() => props.editable && setEditing(blank(null, d))} className={`border-l border-t border-surface-line p-0.5 align-top ${props.editable ? 'cursor-pointer hover:bg-brand-50/40' : ''}`}>
                    <div className="min-h-[34px] space-y-0.5">{(byDay.get(`open|${d}`) ?? []).map(chip)}</div>
                  </td>
                ))}
                <td className="border-l border-t border-surface-line" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && props.editable && (
        <section className="card space-y-3 border-brand-600">
          <h2 className="text-lg">{editing.id ? t('Schicht ändern') : t('Neue Schicht')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="person">{t('Mitarbeiter')}</label>
              <select id="person" className="w-full" value={editing.userId ?? ''} onChange={(e) => setEditing({ ...editing, userId: e.target.value || null })}>
                <option value="">{t('– offen (noch niemand) –')}</option>
                {props.people.map((p) => (
                  <option key={p.userId} value={p.userId}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="date">{t('Tag')}</label>
              <select id="date" className="w-full" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })}>
                {dates.map((d) => (
                  <option key={d} value={d}>{weekdayShort(d, t.lang)} {dm(d)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {SHIFT_PRESETS.map((pr) => (
              <button key={pr.label} type="button" className="btn-secondary min-h-0 px-3 py-1.5 text-sm" onClick={() => setEditing({ ...editing, start: pr.start, end: pr.end })}>
                {t(pr.label)} {pr.start}–{pr.end}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="start">{t('Beginn')}</label>
              <input id="start" inputMode="numeric" className="w-full" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="end">{t('Ende')}</label>
              <input id="end" inputMode="numeric" className="w-full" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="brk">{t('Pause (Min.)')}</label>
              <input id="brk" inputMode="numeric" className="w-full" value={editing.breakMin} onChange={(e) => setEditing({ ...editing, breakMin: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="station">{t('Station')}</label>
              <select id="station" className="w-full" value={editing.station} onChange={(e) => setEditing({ ...editing, station: e.target.value })}>
                {stations.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="role">{t('Aufgabe')}</label>
              <input id="role" className="w-full" value={editing.roleLabel} maxLength={80} placeholder={t('z. B. Abendschicht · Drinks')} onChange={(e) => setEditing({ ...editing, roleLabel: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={pending} onClick={save}>{t('Speichern')}</button>
            <button className="btn-secondary" onClick={() => setEditing(null)}>{t('Abbrechen')}</button>
            {editing.id && (
              <button className="btn-danger ml-auto" disabled={pending} onClick={() => run(() => deleteShiftAction(editing.id!), () => setEditing(null))}>
                {t('Löschen')}
              </button>
            )}
          </div>
        </section>
      )}

      {props.editable && (errors.length > 0 || warnings.length > 0) && (
        <section className="space-y-2">
          {errors.length > 0 && (
            <div className="rounded-btn bg-danger-50 p-3">
              <h3 className="mb-1 text-sm text-danger-500">{t('Fehler – so kann der Plan nicht veröffentlicht werden')}</h3>
              <ul className="space-y-0.5 text-sm text-danger-500">
                {errors.map((v, i) => (
                  <li key={i}>• {t(v.message)}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="rounded-btn bg-warn-50 p-3">
              <h3 className="mb-1 text-sm text-warn-500">{t('Hinweise')}</h3>
              <ul className="space-y-0.5 text-sm text-warn-500">
                {warnings.map((v, i) => (
                  <li key={i}>• {t(v.message)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
