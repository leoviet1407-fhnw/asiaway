'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
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
import { absenceStepAction, deleteShiftAction, enterAbsenceAction, publishMonthAction, saveShiftAction, suggestMonthAction, suggestWeekAction, weekStepAction } from '../../actions';
import { useT } from '@/i18n/client';
import { TimeField, normalizeTime } from '@/components/TimeField';
import { Icon } from '@/components/Icon';

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
  /** The running week, already under way: only single shifts change, from today on. */
  running?: boolean;
  /** Days before this date are over and cannot be changed (YYYY-MM-DD). */
  lockedBefore?: string;
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

/** A copied shift: pasted with one tap into other cells. */
type Clip = Pick<Editing, 'start' | 'end' | 'breakMin' | 'station' | 'roleLabel'>;

const toMin = (v: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const BREAKS = [0, 15, 30, 45, 60, 90];

const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;

/** Where the shift details open: right under the tapped square (desktop) or as a sheet from the bottom (phone). */
type Anchor = { top: number; left: number; wide: boolean } | null;
/** What a deleted shift was, so it can be put back with one tap. */
type Undo = { label: string; input: Parameters<typeof saveShiftAction>[0] } | null;
const PANEL_WIDTH = 440;

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
  const [clip, setClip] = useState<Clip | null>(null);
  const [pasted, setPasted] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor>(null);
  const [undo, setUndo] = useState<Undo>(null);
  const [pasteCount, setPasteCount] = useState(0);
  const [alsoDays, setAlsoDays] = useState<string[]>([]);
  /** The details box shows a shift, or holidays / sick leave for the person. */
  const [mode, setMode] = useState<'shift' | 'absence'>('shift');
  const [absence, setAbsence] = useState<{ type: 'VACATION' | 'SICK' | 'OTHER'; from: string; to: string; release: boolean }>({ type: 'VACATION', from: '', to: '', release: true });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  /** Opens the details as a dropdown under the square that was tapped. */
  const openAt = (el: HTMLElement, value: Editing) => {
    const root = rootRef.current?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (root) {
      const width = Math.min(PANEL_WIDTH, root.width);
      setAnchor({ top: box.bottom - root.top + 4, left: Math.max(0, Math.min(box.left - root.left, root.width - width)), wide: window.innerWidth >= 640 });
    }
    setError(null);
    setAlsoDays([]);
    // a day that already has holidays opens on them; otherwise on the shift
    setMode(!value.id && value.userId && absenceOn(value.userId, value.date) ? 'absence' : 'shift');
    setAbsence({ type: 'VACATION', from: value.date, to: value.date, release: true });
    setEditing(value);
  };
  const close = () => {
    setEditing(null);
    setAnchor(null);
  };
  // The "undo" bar goes away by itself after a while
  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), 10000);
    return () => window.clearTimeout(id);
  }, [undo]);

  // Escape closes; the open dropdown is scrolled into view
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, editing?.date, editing?.userId === undefined]);

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

  const inputOf = (e: Editing, date = e.date) => ({ site: props.site, date, userId: e.userId, start: normalizeTime(e.start), end: normalizeTime(e.end), breakMin: Number(e.breakMin) || 0, station: e.station, roleLabel: e.roleLabel });

  /** Saves the shift, and the same shift on the extra days that were ticked ("Auch an diesen Tagen"). */
  const save = () => {
    if (!editing) return;
    const extra = alsoDays.filter((d) => d !== editing.date);
    run(async () => {
      const first = await saveShiftAction({ id: editing.id, ...inputOf(editing) });
      if (!first.ok) return first;
      for (const d of extra) {
        const r = await saveShiftAction(inputOf(editing, d));
        if (!r.ok) return { ok: false, error: `${weekdayShort(d, t.lang)} ${dm(d)}: ${r.error ?? t('Fehler')}` };
      }
      if (extra.length > 0) setNotice(t('Gespeichert, auch an {n} weiteren Tagen.', { n: extra.length }));
      return first;
    }, close);
  };

  const ABSENCE_TEXT = { VACATION: 'Ferien', SICK: 'Krank', OTHER: 'Abwesend' } as const;
  /** Holidays, sick leave or an absence for the person, approved at once. */
  const saveAbsence = () => {
    if (!editing?.userId) return;
    const who = props.people.find((p) => p.userId === editing.userId)?.name ?? '';
    const from = absence.from || editing.date;
    const to = absence.to || from;
    run(async () => {
      const r = await enterAbsenceAction({ userId: editing.userId!, startDate: from, endDate: to, type: absence.type, releaseShifts: absence.release });
      if (r.ok) {
        const span = from === to ? dm(from) : `${dm(from)}–${dm(to)}`;
        setNotice(t('Eingetragen: {who}, {what} {span}', { who, what: t(ABSENCE_TEXT[absence.type]), span }) + ((r.value ?? 0) > 0 ? ` ${t('{n} Schichten sind jetzt offen.', { n: r.value ?? 0 })}` : ''));
      }
      return r;
    }, close);
  };
  const deleteAbsence = (id: string) => run(() => absenceStepAction(id, 'cancel'), close);

  /** Deletes at once; the bar at the bottom can put it back. */
  const remove = (s: { id: string; userId: string | null; date: string; startMin: number; endMin: number; breakMin: number; station: string; roleLabel: string | null }) => {
    const who = s.userId ? props.people.find((p) => p.userId === s.userId)?.name : t('Offen');
    const label = `${who ?? ''}, ${weekdayShort(s.date, t.lang)} ${dm(s.date)} ${formatTime(s.startMin)}–${formatTime(s.endMin)}`;
    const input = { site: props.site, date: s.date, userId: s.userId, start: formatTime(s.startMin), end: formatTime(s.endMin), breakMin: s.breakMin, station: s.station, roleLabel: s.roleLabel ?? '' };
    run(() => deleteShiftAction(s.id), () => {
      close();
      setUndo({ label, input });
    });
  };
  const restore = () => {
    if (!undo) return;
    const input = undo.input;
    setUndo(null);
    run(() => saveShiftAction(input));
  };

  const copyShift = (s: Shift) => {
    setClip({ start: formatTime(s.startMin), end: formatTime(s.endMin), breakMin: String(s.breakMin), station: s.station, roleLabel: s.roleLabel ?? '' });
    setPasteCount(0);
    setPasted(null);
    setNotice(null);
  };

  const copy = () => {
    if (!editing) return;
    setClip({ start: normalizeTime(editing.start), end: normalizeTime(editing.end), breakMin: editing.breakMin, station: editing.station, roleLabel: editing.roleLabel });
    close();
    setNotice(null);
    setPasted(null);
    setPasteCount(0);
  };

  /** In paste mode a tap on a cell adds the copied shift there at once. */
  const paste = (userId: string | null, date: string) => {
    if (!clip) return;
    const who = userId ? props.people.find((p) => p.userId === userId)?.name : t('Offen');
    run(
      () => saveShiftAction({ site: props.site, date, userId, start: clip.start, end: clip.end, breakMin: Number(clip.breakMin) || 0, station: clip.station, roleLabel: clip.roleLabel }),
      () => {
        setPasted(t('Eingefügt: {who}, {day}', { who: who ?? '', day: `${weekdayShort(date, t.lang)} ${dm(date)}` }));
        setPasteCount((n) => n + 1);
      },
    );
  };
  /** Whether a day can still be changed: not in a week that is closed, not a day that is over. */
  const canEdit = (date: string) => props.editable && !(props.lockedBefore && date < props.lockedBefore);
  const cellClick = (userId: string | null, date: string, el: HTMLElement) => {
    if (!canEdit(date)) return;
    if (clip) paste(userId, date);
    else openAt(el, blank(userId, date));
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
      <div key={s.id} className="group relative">
      <button
        type="button"
        disabled={!canEdit(s.date)}
        onClick={(e) => {
          e.stopPropagation();
          if (clip) paste(s.userId, s.date);
          else openAt(e.currentTarget, edit(s));
        }}
        className="block w-full rounded px-1 py-0.5 text-left text-[11px] font-semibold leading-tight"
        style={{ background: st?.color ?? '#e3e1df', color: st?.textColor ?? '#09141d' }}
        title={`${s.station}${s.roleLabel ? ` · ${s.roleLabel}` : ''}`}
      >
        {formatTime(s.startMin)}–{formatTime(s.endMin)}
        <span className="block font-normal opacity-80">{s.roleLabel ?? s.station}</span>
      </button>
      {canEdit(s.date) && !clip && (
        // quick actions on hover (mouse); on a phone the same is in the details
        <div className="absolute right-0.5 top-0.5 hidden gap-0.5 md:group-hover:flex">
          <button type="button" className="rounded bg-white/90 p-0.5 text-navy shadow hover:bg-white" title={t('Kopieren')} aria-label={t('Kopieren')} onClick={(e) => { e.stopPropagation(); copyShift(s); }}>
            <Icon name="copy" className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rounded bg-white/90 p-0.5 text-brand-600 shadow hover:bg-white" title={t('Löschen')} aria-label={t('Löschen')} disabled={pending} onClick={(e) => { e.stopPropagation(); remove(s); }}>
            <Icon name="trash" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="relative space-y-4">
      {props.editable && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${props.status === 'PUBLISHED' ? 'bg-ok-50 text-ok-500' : 'bg-warn-50 text-warn-500'}`}>{props.status === 'PUBLISHED' ? t('Veröffentlicht') : t('Entwurf – Mitarbeiter sehen noch nichts')}</span>
          {!props.running && (
          <>
          <button className="btn-secondary min-h-0 px-3 py-1.5 text-sm" disabled={pending || props.shifts.length > 0} onClick={() => run(() => weekStepAction(props.site, props.weekStart, 'copy'), () => setNotice(t('Letzte Woche übernommen.')))}>
            {t('Letzte Woche kopieren')}
          </button>
          <button
            className="btn-secondary min-h-0 px-3 py-1.5 text-sm"
            disabled={pending}
            title={props.shifts.length > 0 ? t('Behält, was schon geplant ist, und füllt nur die fehlenden Plätze.') : undefined}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await suggestWeekAction(props.site, props.weekStart);
                if (!r.ok) return setError(r.error);
                const gaps = r.gaps ?? [];
                const names = gaps.map((g) => `${weekdayShort(g.date, t.lang)} ${g.service === 'LUNCH' ? t('Mittag') : t('Abend')} (${g.missing})`).join(', ');
                setNotice(t('Vorschlag: {n} Schichten ergänzt. Bitte prüfen und anpassen.', { n: r.created ?? 0 }) + (gaps.length ? ` ${t('Lücken')}: ${names}.` : ''));
                router.refresh();
              })
            }
          >
            {t('Diese Woche vorschlagen')}
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
          </>
          )}
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
      {clip && props.editable && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-btn bg-navy p-3 text-white">
          <span className="font-semibold">{t('Einfügen')}: {clip.start}–{clip.end} · {clip.roleLabel || clip.station}</span>
          <span className="text-sm text-white/80">{pending ? '…' : pasted ? `✓ ${pasted}` : t('Tippen Sie auf ein Feld, um die Schicht dort einzufügen.')}</span>
          <button className="btn-secondary ml-auto min-h-0 px-3 py-1.5 text-sm" onClick={() => { setClip(null); setPasted(null); setPasteCount(0); }}>
            {pasteCount > 0 ? t('Fertig ({n} eingefügt)', { n: pasteCount }) : t('Fertig')}
          </button>
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
                        onClick={(e) => cellClick(person.userId, d, e.currentTarget)}
                        className={`border-l border-t border-surface-line p-0.5 align-top ${canEdit(d) ? (clip ? 'cursor-copy hover:bg-ok-50' : 'cursor-pointer hover:bg-brand-50/40') : ''} ${absence ? 'bg-surface-line/70' : ''}`}
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
                  <td key={d} onClick={(e) => cellClick(null, d, e.currentTarget)} className={`border-l border-t border-surface-line p-0.5 align-top ${canEdit(d) ? (clip ? 'cursor-copy hover:bg-ok-50' : 'cursor-pointer hover:bg-brand-50/40') : ''}`}>
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
        <>
          {/* a tap outside closes the dropdown */}
          <div className="fixed inset-0 z-30 bg-navy/20 sm:bg-transparent" onClick={close} aria-hidden />
          <section
            ref={panelRef}
            role="dialog"
            aria-label={editing.id ? t('Schicht ändern') : t('Neue Schicht')}
            className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] space-y-3 overflow-y-auto rounded-t-card border border-brand-600 bg-white p-4 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:max-h-none sm:rounded-card"
            style={anchor?.wide ? { top: anchor.top, left: anchor.left, width: PANEL_WIDTH } : undefined}
          >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg">{mode === 'absence' ? t('Ferien / Abwesenheit') : editing.id ? t('Schicht ändern') : t('Neue Schicht')}</h2>
            <button type="button" className="btn-ghost min-h-0 px-2 py-1 text-lg leading-none" onClick={close} aria-label={t('Schliessen')}>×</button>
          </div>
          {!editing.id && editing.userId && (
            <div role="tablist" className="grid grid-cols-2 gap-1 rounded-btn bg-surface-sunken p-1">
              {(['shift', 'absence'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-btn px-3 py-1.5 text-sm font-semibold ${mode === m ? 'bg-white text-navy shadow' : 'text-charcoal-muted'}`}>
                  {m === 'shift' ? t('Schicht') : t('Ferien / Abwesenheit')}
                </button>
              ))}
            </div>
          )}
          {editing.userId && (() => {
            const a = absenceOn(editing.userId, editing.date);
            if (!a) return null;
            const span = a.startDate === a.endDate ? dm(a.startDate) : `${dm(a.startDate)}–${dm(a.endDate)}`;
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-btn bg-navy-50 p-2 text-sm text-navy">
                <span>{t(ABSENCE_TEXT[a.type])}: {span}</span>
                {a.id && (
                  <button type="button" className="btn-secondary min-h-0 gap-1.5 px-3 py-1 text-sm text-brand-600" disabled={pending} onClick={() => deleteAbsence(a.id!)}>
                    <Icon name="trash" className="h-4 w-4" /> {t('Abwesenheit löschen')}
                  </button>
                )}
              </div>
            );
          })()}
          {mode === 'absence' && editing.userId ? (
            <>
              <div>
                <label className="label" htmlFor="abs-type">{t('Art')}</label>
                <select id="abs-type" className="w-full" value={absence.type} onChange={(e) => setAbsence({ ...absence, type: e.target.value as 'VACATION' | 'SICK' | 'OTHER' })}>
                  <option value="VACATION">{t('Ferien')}</option>
                  <option value="SICK">{t('Krank')}</option>
                  <option value="OTHER">{t('Abwesend')}</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="abs-from">{t('Von')}</label>
                  <input id="abs-from" type="date" className="w-full" value={absence.from} onChange={(e) => setAbsence({ ...absence, from: e.target.value, to: absence.to < e.target.value ? e.target.value : absence.to })} />
                </div>
                <div>
                  <label className="label" htmlFor="abs-to">{t('Bis')}</label>
                  <input id="abs-to" type="date" className="w-full" min={absence.from} value={absence.to} onChange={(e) => setAbsence({ ...absence, to: e.target.value })} />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 min-h-0 accent-brand-600" checked={absence.release} onChange={(e) => setAbsence({ ...absence, release: e.target.checked })} />
                <span>{t('Schichten in dieser Zeit freigeben – sie werden zu offenen Schichten (ab heute).')}</span>
              </label>
              {error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">{error}</p>}
              <button className="btn-primary w-full" disabled={pending || !absence.from} onClick={saveAbsence}>{t('Eintragen')}</button>
              <button className="btn-ghost min-h-0 w-full px-3 py-2 text-sm" onClick={close}>{t('Abbrechen')}</button>
            </>
          ) : (
          <>
          <div className="grid grid-cols-2 gap-3">
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
          <div className="flex flex-wrap gap-1.5">
            {SHIFT_PRESETS.map((pr) => (
              <button key={pr.label} type="button" className="btn-secondary min-h-0 px-2 py-1 text-xs" onClick={() => setEditing({ ...editing, start: pr.start, end: pr.end })}>
                {t(pr.label)} {pr.start}–{pr.end}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TimeField id="start" label={t('Beginn')} value={editing.start} onChange={(v) => setEditing({ ...editing, start: v })} />
            <TimeField id="end" label={t('Ende')} value={editing.end} onChange={(v) => setEditing({ ...editing, end: v })} />
            <div className="col-span-2">
              <label className="label" htmlFor="brk">{t('Pause (Min.)')}</label>
              <select id="brk" className="w-full" value={editing.breakMin} onChange={(e) => setEditing({ ...editing, breakMin: e.target.value })}>
                {(BREAKS.includes(Number(editing.breakMin)) ? BREAKS : [...BREAKS, Number(editing.breakMin) || 0].sort((a, b) => a - b)).map((b) => (
                  <option key={b} value={String(b)}>{b === 0 ? t('keine') : `${b} min`}</option>
                ))}
              </select>
            </div>
          </div>
          {(() => {
            const s = toMin(normalizeTime(editing.start));
            const e = toMin(normalizeTime(editing.end));
            if (s === null || e === null) return null;
            const net = (e > s ? e - s : e + 1440 - s) - (Number(editing.breakMin) || 0);
            return <p className="text-sm text-charcoal-muted">{t('Arbeitszeit')}: <strong className="text-navy">{formatHours(net)}</strong></p>;
          })()}
          <div className="grid grid-cols-2 gap-3">
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
          <div>
            <div className="label">{t('Auch an diesen Tagen')}</div>
            <div className="flex flex-wrap gap-1">
              {dates.filter((d) => d !== editing.date && canEdit(d)).map((d) => {
                const on = alsoDays.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setAlsoDays(on ? alsoDays.filter((x) => x !== d) : [...alsoDays, d])} className={`chip px-2.5 py-1 ${on ? 'bg-navy text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>
                    {weekdayShort(d, t.lang)}
                  </button>
                );
              })}
            </div>
          </div>
          {error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">{error}</p>}
          <button className="btn-primary w-full" disabled={pending} onClick={save}>
            {alsoDays.length > 0 ? t('Speichern (+{n} Tage)', { n: alsoDays.length }) : t('Speichern')}
          </button>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary min-h-0 flex-1 gap-1.5 px-3 py-2 text-sm" disabled={pending} onClick={copy} title={t('Diese Zeiten kopieren und in andere Felder einfügen')}>
              <Icon name="copy" className="h-4 w-4" /> {t('Kopieren & einfügen')}
            </button>
            {editing.id && (
              <button
                className="btn-secondary min-h-0 flex-1 gap-1.5 px-3 py-2 text-sm text-brand-600"
                disabled={pending}
                onClick={() => {
                  const s = props.shifts.find((x) => x.id === editing.id);
                  if (s) remove(s);
                }}
              >
                <Icon name="trash" className="h-4 w-4" /> {t('Löschen')}
              </button>
            )}
            <button className="btn-ghost min-h-0 px-3 py-2 text-sm" onClick={close}>{t('Abbrechen')}</button>
          </div>
          </>
          )}
          </section>
        </>
      )}

      {undo && (
        <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-btn bg-navy p-3 text-white shadow-xl md:bottom-6">
          <span className="min-w-0 flex-1 text-sm">{t('Gelöscht')}: {undo.label}</span>
          <button className="btn-secondary min-h-0 gap-1.5 px-3 py-1.5 text-sm" disabled={pending} onClick={restore}>
            <Icon name="undo" className="h-4 w-4" /> {t('Rückgängig')}
          </button>
        </div>
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
