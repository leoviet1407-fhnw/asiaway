'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { applyPatternAction, savePatternAction } from '../../../actions';
import { useT } from '@/i18n/client';

export interface PatternRow {
  weekday: number;
  mode: '' | 'ALL' | 'WINDOW' | 'NO';
  from: string;
  to: string;
}

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** The Standardwoche: set once, then fill every month with one tap. */
export function PatternPanel({ userId, month, monthLabel, rows, canApply }: { userId: string; month: string; monthLabel: string; rows: PatternRow[]; canApply: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [list, setList] = useState(rows);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saved = JSON.stringify(list) === JSON.stringify(rows);
  const hasAny = list.some((r) => r.mode !== '');
  const set = (i: number, patch: Partial<PatternRow>) => setList(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const run = (fn: () => Promise<{ ok: boolean; error?: string; days?: number }>, done: (r: { days?: number }) => string) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) setMsg({ ok: false, text: r.error ?? t('Fehler') });
      else {
        setMsg({ ok: true, text: done(r) });
        router.refresh();
      }
    });

  return (
    <details className="card" open={!hasAny}>
      <summary className="cursor-pointer text-lg font-semibold text-navy">{t('Meine Standardwoche')}</summary>
      <p className="mt-2 text-sm text-charcoal-muted">{t('Stellen Sie einmal ein, wann Sie normalerweise arbeiten können. Danach füllt ein Tipp den ganzen Monat. Sie ändern nur noch die Ausnahmen.')}</p>
      <ul className="mt-3 divide-y divide-surface-line">
        {list.map((r, i) => (
          <li key={r.weekday} className="flex flex-wrap items-center gap-2 py-2">
            <span className="w-24 font-semibold text-navy">{t(DAYS[i]!)}</span>
            <select className="min-w-[9rem]" value={r.mode} onChange={(e) => set(i, { mode: e.target.value as PatternRow['mode'] })} aria-label={t(DAYS[i]!)}>
              <option value="">{t('nicht festgelegt')}</option>
              <option value="ALL">{t('Ganzer Tag')}</option>
              <option value="WINDOW">{t('Von – bis')}</option>
              <option value="NO">{t('Nicht verfügbar')}</option>
            </select>
            {r.mode === 'WINDOW' && (
              <>
                <input inputMode="numeric" className="w-20" value={r.from} placeholder="10:30" onChange={(e) => set(i, { from: e.target.value })} aria-label={t('Beginn')} />
                <span>–</span>
                <input inputMode="numeric" className="w-20" value={r.to} placeholder="22:00" onChange={(e) => set(i, { to: e.target.value })} aria-label={t('Ende')} />
              </>
            )}
          </li>
        ))}
      </ul>
      {msg && <p role="status" className={`mt-2 rounded-btn p-2 text-sm ${msg.ok ? 'bg-ok-50 text-ok-500' : 'bg-danger-50 text-danger-500'}`}>{msg.text}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={pending || saved} onClick={() => run(() => savePatternAction(userId, list.map((r) => ({ weekday: r.weekday, mode: r.mode, from: r.from, to: r.to }))), () => t('Standardwoche gespeichert.'))}>
          {t('Standardwoche speichern')}
        </button>
        {canApply && (
          <button className="btn-primary" disabled={pending || !saved || !hasAny} onClick={() => run(() => applyPatternAction(userId, month), (r) => (r.days ? t('{n} Tage aus der Standardwoche eingetragen.', { n: r.days }) : t('Es gab nichts mehr einzutragen.')))}>
            {t('In {month} eintragen', { month: monthLabel })}
          </button>
        )}
      </div>
      {!saved && hasAny && <p className="mt-2 text-xs text-charcoal-muted">{t('Bitte zuerst speichern.')}</p>}
    </details>
  );
}
