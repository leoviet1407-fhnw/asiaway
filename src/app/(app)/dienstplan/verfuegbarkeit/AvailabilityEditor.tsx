'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { DINNER_WINDOW, LUNCH_WINDOW, STANDARD_DAY_MINUTES, weekStatus } from '@/domain/availability';
import { formatTime, weekDates, weekdayShort, type AbsenceType, type AvailabilityDay } from '@/domain/roster';
import { useT } from '@/i18n/client';
import { WEEKLY_HOURS_AT_100 } from '@/domain/hours';
import { setAvailabilityAction, submitMonthAction } from '../../../actions';

interface Props {
  userId: string;
  month: string;
  /** Mondays of the weeks of this month. */
  weeks: string[];
  today: string;
  pensumPercent: number | null;
  isPlanner: boolean;
  isSelf: boolean;
  days: AvailabilityDay[];
  absences: { startDate: string; endDate: string; type: AbsenceType; status: string }[];
  submittedAt: string | null;
}

type Choice = 'ganz' | 'mittag' | 'abend' | 'frei' | 'eigen' | null;

interface Cell {
  kind: 'AVAILABLE' | 'UNAVAILABLE';
  from: string;
  to: string;
}

const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;
const hours = (min: number) => (min / 60).toFixed(min % 60 === 0 ? 0 : 1);

const LUNCH = { from: formatTime(LUNCH_WINDOW.fromMin), to: formatTime(LUNCH_WINDOW.toMin) };
const DINNER = { from: formatTime(DINNER_WINDOW.fromMin), to: formatTime(DINNER_WINDOW.toMin) };

function choiceOf(cell: Cell | undefined): Choice {
  if (!cell) return null;
  if (cell.kind === 'UNAVAILABLE') return 'frei';
  if (!cell.from && !cell.to) return 'ganz';
  if (cell.from === LUNCH.from && cell.to === LUNCH.to) return 'mittag';
  if (cell.from === DINNER.from && cell.to === DINNER.to) return 'abend';
  return 'eigen';
}

function parseHm(value: string): number | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 29 || min > 59 ? null : h * 60 + min;
}

const weeklyNeed = (pensum: number) => Math.round((WEEKLY_HOURS_AT_100 * 60 * pensum) / 100);

/**
 * One week at a time: for every day pick Ganzer Tag, Mittag, Abend or Frei.
 * A bar shows the hours chosen against the contract, and "Meldung abschicken"
 * stays off until every day has a choice and every week reaches its hours.
 */
export function AvailabilityEditor(props: Props) {
  const t = useT();
  const router = useRouter();
  const [cells, setCells] = useState<Record<string, Cell>>(() =>
    Object.fromEntries(props.days.map((d) => [d.date, { kind: d.kind, from: d.fromMin === null ? '' : formatTime(d.fromMin), to: d.toMin === null ? '' : formatTime(d.toMin) }])),
  );
  const [idx, setIdx] = useState(0);
  const [custom, setCustom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(props.submittedAt !== null);
  const [pending, start] = useTransition();

  const real = props.absences.filter((a) => a.status !== 'REJECTED');
  const away = (date: string) => real.find((a) => a.startDate <= date && date <= a.endDate);
  const countsAsAway = (date: string) => real.some((a) => (a.type === 'VACATION' || a.type === 'SICK') && a.startDate <= date && date <= a.endDate);
  // Only days that have passed are closed (for the planner nothing is). Weeks that have started are checked.
  const locked = (date: string) => !props.isPlanner && date < props.today;
  const enforced = (monday: string) => props.isPlanner || weekDates(monday)[6]! >= props.today;
  // People with a Pensum must choose every day; casual staff only enter what they can do, the rest counts as free
  const mustChooseAll = props.pensumPercent !== null;

  const asDay = (date: string, c: Cell): AvailabilityDay => ({ userId: props.userId, date, kind: c.kind, fromMin: c.from ? parseHm(c.from) : null, toMin: c.to ? parseHm(c.to) : null });
  const statusOf = (monday: string) =>
    weekStatus({ weekStart: monday, pensumPercent: props.pensumPercent, availability: Object.entries(cells).map(([date, c]) => asDay(date, c)), absences: real });
  const noChoiceIn = (monday: string) => (mustChooseAll ? weekDates(monday).filter((d) => !locked(d) && !cells[d] && !countsAsAway(d)).length : 0);

  const statuses = useMemo(() => props.weeks.map((w) => ({ monday: w, ...statusOf(w), noChoice: noChoiceIn(w) })), [cells, props.weeks]); // eslint-disable-line react-hooks/exhaustive-deps
  const allGood = statuses.every((s) => s.noChoice === 0 && (!enforced(s.monday) || s.ok));

  const push = (date: string, cell: Cell | null) => {
    setCells((c) => {
      const next = { ...c };
      if (cell) next[date] = cell;
      else delete next[date];
      return next;
    });
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await setAvailabilityAction({ userId: props.userId, date, kind: cell?.kind ?? null, from: cell?.from ?? '', to: cell?.to ?? '' });
      if (!result.ok) {
        setError(result.error);
        router.refresh();
      }
    });
  };

  const choose = (date: string, choice: Exclude<Choice, null>) => {
    setCustom(null);
    if (choice === 'frei') return push(date, { kind: 'UNAVAILABLE', from: '', to: '' });
    if (choice === 'ganz') return push(date, { kind: 'AVAILABLE', from: '', to: '' });
    if (choice === 'mittag') return push(date, { kind: 'AVAILABLE', ...LUNCH });
    if (choice === 'abend') return push(date, { kind: 'AVAILABLE', ...DINNER });
    setCustom(date);
  };

  const monday = props.weeks[idx] ?? props.weeks[0]!;
  const status = statusOf(monday);
  const dates = weekDates(monday);
  const required = status.requiredMinutes;
  const have = status.offeredMinutes + status.creditMinutes;
  const pct = required ? Math.min(100, Math.round((have / required) * 100)) : have > 0 ? 100 : 0;
  const weekEnforced = enforced(monday);

  const option = (active: boolean, tone: 'ok' | 'no') =>
    `btn min-h-[52px] flex-col gap-0 px-2 py-1 text-sm leading-tight ${active ? (tone === 'no' ? 'bg-brand-600 text-white' : 'bg-ok-500 text-white') : 'border border-surface-line bg-white text-navy'}`;

  const label = (c: Cell) => {
    const ch = choiceOf(c);
    return ch === 'frei' ? t('Frei') : ch === 'ganz' ? t('Ganzer Tag') : ch === 'mittag' ? t('Mittag') : ch === 'abend' ? t('Abend') : `${c.from}–${c.to}`;
  };

  return (
    <div className="space-y-4">
      {props.pensumPercent !== null ? (
        <p className="rounded-btn bg-navy-50 p-3 text-sm text-navy">
          {t('Wählen Sie für jeden Tag, wann Sie arbeiten können. Pro Woche brauchen Sie mindestens {hours} h (Pensum {pct} %).', { hours: hours(weeklyNeed(props.pensumPercent)), pct: props.pensumPercent })}
        </p>
      ) : (
        <p className="rounded-btn bg-navy-50 p-3 text-sm text-navy">{t('Tragen Sie ein, wann Sie arbeiten können – Woche für Woche, zum Beispiel die 1. und 2. Woche im Dezember – und schicken Sie es ab. Tage ohne Eintrag gelten als nicht verfügbar.')}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-secondary min-h-tap px-3" disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label={t('Vorherige Woche')}>
          ←
        </button>
        <div className="text-center">
          <div className="font-semibold text-navy">{t('Woche {n} von {total}', { n: idx + 1, total: props.weeks.length })}</div>
          <div className="text-xs text-charcoal-muted">
            {dm(dates[0]!)} – {dm(dates[6]!)}
          </div>
        </div>
        <button type="button" className="btn-secondary min-h-tap px-3" disabled={idx >= props.weeks.length - 1} onClick={() => setIdx(idx + 1)} aria-label={t('Nächste Woche')}>
          →
        </button>
      </div>

      <div className="card space-y-1.5 p-3" role="status">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-navy">{required !== null ? t('{have} von {need} h gewählt', { have: hours(have), need: hours(required) }) : t('{have} h gewählt', { have: hours(have) })}</span>
          {required !== null && weekEnforced && (status.ok ? <span className="chip bg-ok-50 text-ok-500">✓ {t('Geschafft')}</span> : <span className="chip bg-warn-50 text-warn-500">{t('noch {n} h', { n: hours(status.missingMinutes) })}</span>)}
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-surface-line">
          <div className={`h-full rounded-full ${required !== null && status.ok ? 'bg-ok-500' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
        </div>
        {required !== null && weekEnforced && !status.ok && <p className="text-sm text-charcoal">{t('Es fehlen noch {n} h – wählen Sie noch einen Tag oder eine längere Zeit.', { n: hours(status.missingMinutes) })}</p>}
        {status.creditMinutes > 0 && <p className="text-xs text-charcoal-muted">{t('Ferien zählen mit: {n} h', { n: hours(status.creditMinutes) })}</p>}
      </div>

      {error && (
        <p role="alert" className="rounded-btn bg-danger-50 p-3 text-danger-500">
          {error}
        </p>
      )}

      <ul className="space-y-3">
        {dates.map((date) => {
          const cell = cells[date];
          const ch = choiceOf(cell);
          const absence = away(date);
          const isLocked = locked(date);
          const needsChoice = mustChooseAll && ch === null && !isLocked && !countsAsAway(date);
          return (
            <li key={date} className={`card space-y-2 p-3 ${needsChoice ? 'border-warn-500' : ''} ${isLocked ? 'bg-surface-sunken' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-navy">
                  {weekdayShort(date, t.lang)} {dm(date)}
                </span>
                {absence ? (
                  <span className="chip bg-navy text-white">
                    {absence.type === 'VACATION' ? t('Ferien') : absence.type === 'SICK' ? t('Krank') : t('Abwesend')}
                    {absence.status === 'REQUESTED' ? ` (${t('angefragt')})` : ''}
                  </span>
                ) : isLocked ? (
                  <span className="text-xs text-charcoal-muted">{t('vorbei')}</span>
                ) : needsChoice ? (
                  <span className="text-xs font-semibold text-warn-500">{t('bitte wählen')}</span>
                ) : cell ? (
                  <span className="text-xs font-semibold text-ok-500">✓ {label(cell)}</span>
                ) : (
                  <span className="text-xs text-charcoal-muted">{t('nicht gemeldet = frei')}</span>
                )}
              </div>
              {!countsAsAway(date) && !isLocked && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={`${t('Verfügbarkeit')} ${date}`}>
                    <button type="button" className={option(ch === 'ganz', 'ok')} onClick={() => choose(date, 'ganz')}>
                      <span className="font-semibold">{t('Ganzer Tag')}</span>
                      <span className="text-xs opacity-80">{hours(STANDARD_DAY_MINUTES)} h</span>
                    </button>
                    <button type="button" className={option(ch === 'mittag', 'ok')} onClick={() => choose(date, 'mittag')}>
                      <span className="font-semibold">{t('Mittag')}</span>
                      <span className="text-xs opacity-80">
                        {LUNCH.from}–{LUNCH.to}
                      </span>
                    </button>
                    <button type="button" className={option(ch === 'abend', 'ok')} onClick={() => choose(date, 'abend')}>
                      <span className="font-semibold">{t('Abend')}</span>
                      <span className="text-xs opacity-80">
                        {DINNER.from}–{DINNER.to}
                      </span>
                    </button>
                    <button type="button" className={option(ch === 'frei', 'no')} onClick={() => choose(date, 'frei')}>
                      <span className="font-semibold">{t('Frei')}</span>
                      <span className="text-xs opacity-80">{t('ich kann nicht')}</span>
                    </button>
                  </div>
                  {custom === date || ch === 'eigen' ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-charcoal-muted">{t('Eigene Zeit')}:</span>
                      <input aria-label={t('von')} inputMode="numeric" className="w-20 px-2 py-1 text-center" placeholder="10:30" defaultValue={cell?.from ?? ''} id={`from-${date}`} />
                      <span>–</span>
                      <input aria-label={t('bis')} inputMode="numeric" className="w-20 px-2 py-1 text-center" placeholder="18:00" defaultValue={cell?.to ?? ''} id={`to-${date}`} />
                      <button
                        type="button"
                        className="btn-secondary min-h-0 px-3 py-1.5 text-sm"
                        onClick={() => {
                          const from = (document.getElementById(`from-${date}`) as HTMLInputElement).value.trim();
                          const to = (document.getElementById(`to-${date}`) as HTMLInputElement).value.trim();
                          const a = parseHm(from);
                          const b = parseHm(to);
                          if (a === null || b === null || b <= a) return setError(t('Zeit ist ungültig (z. B. 10:30).'));
                          setCustom(null);
                          push(date, { kind: 'AVAILABLE', from, to });
                        }}
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="text-xs text-brand-600 underline" onClick={() => setCustom(date)}>
                      {t('Eigene Zeit eingeben')}
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2">
        {idx > 0 && (
          <button type="button" className="btn-secondary flex-1" onClick={() => setIdx(idx - 1)}>
            ← {t('Vorherige Woche')}
          </button>
        )}
        {idx < props.weeks.length - 1 && (
          <button type="button" className="btn-primary flex-1" onClick={() => setIdx(idx + 1)}>
            {t('Nächste Woche')} →
          </button>
        )}
      </div>

      <section className="card space-y-3">
        <h2 className="text-lg">{t('Prüfen und abschicken')}</h2>
        <ul className="space-y-1.5 text-sm">
          {statuses.map((s, i) => {
            const ok = s.noChoice === 0 && (!enforced(s.monday) || s.ok);
            return (
              <li key={s.monday} className="flex items-center justify-between gap-2">
                <span>
                  <span className={ok ? 'text-ok-500' : 'text-warn-500'}>{ok ? '✓' : '!'}</span> {t('Woche ab')} {dm(s.monday)}
                  {s.requiredMinutes !== null && enforced(s.monday) && ` · ${hours(s.offeredMinutes + s.creditMinutes)} / ${hours(s.requiredMinutes)} h`}
                  {s.noChoice > 0 && ` · ${t('{n} Tage ohne Auswahl', { n: s.noChoice })}`}
                </span>
                {!ok && (
                  <button type="button" className="text-brand-600 underline" onClick={() => setIdx(i)}>
                    {t('ansehen')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {props.isSelf ? (
          <>
            {!allGood && <p className="rounded-btn bg-warn-50 p-3 text-sm text-warn-500">{t('Noch nicht fertig: Jeder Tag braucht eine Auswahl, und jede Woche muss zu Ihrem Pensum passen.')}</p>}
            {allGood && !mustChooseAll && !saved && <p className="rounded-btn bg-navy-50 p-3 text-sm text-navy">{t('Tage ohne Eintrag gelten als nicht verfügbar. Sie können jederzeit nochmals ändern.')}</p>}
            {saved && allGood && <p className="rounded-btn bg-ok-50 p-3 text-sm font-semibold text-ok-500">{t('Meldung abgeschickt ✓')}</p>}
            <button
              className="btn-primary w-full"
              disabled={pending || !allGood}
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
              {saved ? t('Nochmals abschicken') : t('Meldung abschicken')}
            </button>
          </>
        ) : (
          <p className="text-xs text-charcoal-muted">{t('Sie bearbeiten die Meldung für jemand anderen.')}</p>
        )}
      </section>
    </div>
  );
}
