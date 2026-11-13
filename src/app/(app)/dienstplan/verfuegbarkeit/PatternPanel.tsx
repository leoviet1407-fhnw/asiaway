'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { savePatternAction } from '../../../actions';
import { useT } from '@/i18n/client';

export interface PatternRow {
  weekday: number;
  mode: '' | 'ALL' | 'LUNCH' | 'DINNER' | 'WINDOW' | 'NO';
  from: string;
  to: string;
}

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/**
 * The Standardwoche: when you can usually work. It applies to every week by itself;
 * the week-by-week list below is only for exceptions.
 */
export function PatternPanel({ userId, rows, fixedDays = false }: { userId: string; rows: PatternRow[]; fixedDays?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [list, setList] = useState(rows);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saved = JSON.stringify(list) === JSON.stringify(rows);
  const hasAny = list.some((r) => r.mode !== '');
  const set = (i: number, patch: Partial<PatternRow>) => setList(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await savePatternAction(userId, list.map((x) => ({ weekday: x.weekday, mode: x.mode, from: x.from, to: x.to })));
      if (!r.ok) setMsg({ ok: false, text: r.error ?? t('Fehler') });
      else {
        setMsg({ ok: true, text: t('Standardwoche gespeichert. Sie gilt ab jetzt für jede Woche.') });
        router.refresh();
      }
    });

  return (
    <section className="card">
      <h2 className="text-lg font-semibold text-navy">{fixedDays ? t('Feste Arbeitstage') : t('Meine Standardwoche')}</h2>
      <p className="mt-1 text-sm text-charcoal-muted">{fixedDays ? t('An welchen Tagen arbeitet diese Person? Nur an diesen Tagen wird sie eingeteilt, an den anderen nicht. Leer lassen = jeden Tag.') : t('Wann können Sie normalerweise arbeiten? Einmal einstellen, dann gilt es für jede Woche. Nur Ausnahmen tragen Sie weiter unten ein.')}</p>
      <ul className="mt-3 divide-y divide-surface-line">
        {list.map((r, i) => (
          <li key={r.weekday} className="flex flex-wrap items-center gap-2 py-2">
            <span className="w-24 font-semibold text-navy">{t(DAYS[i]!)}</span>
            <select className="min-w-[10rem]" value={r.mode} onChange={(e) => set(i, { mode: e.target.value as PatternRow['mode'] })} aria-label={t(DAYS[i]!)}>
              <option value="">{t('nicht festgelegt')}</option>
              <option value="ALL">{t('Ganzer Tag')}</option>
              <option value="LUNCH">{t('Mittag')} 10:30–14:30</option>
              <option value="DINNER">{t('Abend')} 17:30–22:00</option>
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
      <button className="btn-primary mt-3" disabled={pending || saved || !hasAny} onClick={save}>
        {t('Standardwoche speichern')}
      </button>
    </section>
  );
}
