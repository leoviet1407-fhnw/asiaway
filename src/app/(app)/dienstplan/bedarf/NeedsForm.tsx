'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { weekdayShort } from '@/domain/roster';
import { useT } from '@/i18n/client';
import { deriveNeedsAction, saveNeedsAction } from '../../../actions';

interface Props {
  site: string;
  weekStart: string;
  /** Monday … Sunday */
  needs: { lunchPeople: number; dinnerPeople: number }[];
  dates: string[];
}

/** How many people the site needs per weekday – typed in, or taken from a planned week. */
export function NeedsForm({ site, weekStart, needs, dates }: Props) {
  const t = useT();
  const router = useRouter();
  const [values, setValues] = useState(needs.map((n) => ({ lunch: String(n.lunchPeople), dinner: String(n.dinnerPeople) })));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const set = (i: number, key: 'lunch' | 'dinner', v: string) => {
    setMsg(null);
    setValues((all) => all.map((x, j) => (j === i ? { ...x, [key]: v.replace(/\D/g, '').slice(0, 2) } : x)));
  };

  return (
    <section className="card space-y-3">
      <h2 className="text-lg">{t('Bedarf festlegen')}</h2>
      <p className="text-sm text-charcoal-muted">{t('Wie viele Personen braucht Winterthur pro Tag? Das gilt für jede Woche, bis Sie es ändern.')}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs text-charcoal-muted">
              <th className="py-1">{t('Tag')}</th>
              <th className="py-1">{t('Mittag')} (10:30–14:30)</th>
              <th className="py-1">{t('Abend')} (17:30–22:00)</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((d, i) => (
              <tr key={d} className="border-t border-surface-line">
                <td className="py-1.5 font-semibold text-navy">{weekdayShort(d, t.lang)}</td>
                <td className="py-1.5">
                  <input aria-label={`${weekdayShort(d, t.lang)} ${t('Mittag')}`} inputMode="numeric" className="w-16 text-center" value={values[i]!.lunch} onChange={(e) => set(i, 'lunch', e.target.value)} onFocus={(e) => e.target.select()} />
                </td>
                <td className="py-1.5">
                  <input aria-label={`${weekdayShort(d, t.lang)} ${t('Abend')}`} inputMode="numeric" className="w-16 text-center" value={values[i]!.dinner} onChange={(e) => set(i, 'dinner', e.target.value)} onFocus={(e) => e.target.select()} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && (
        <p role="status" className={`rounded-btn p-2 text-sm ${msg.ok ? 'bg-ok-50 text-ok-500' : 'bg-danger-50 text-danger-500'}`}>
          {msg.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveNeedsAction(site, values.map((v) => ({ lunchPeople: Number(v.lunch) || 0, dinnerPeople: Number(v.dinner) || 0 })));
              setMsg({ ok: r.ok, text: r.ok ? t('Gespeichert.') : r.error });
              if (r.ok) router.refresh();
            })
          }
        >
          {t('Speichern')}
        </button>
        <button
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await deriveNeedsAction(site, weekStart);
              setMsg({ ok: r.ok, text: r.ok ? t('Bedarf aus dem Plan dieser Woche übernommen.') : r.error });
              if (r.ok) router.refresh();
            })
          }
        >
          {t('Aus dem Plan dieser Woche übernehmen')}
        </button>
      </div>
    </section>
  );
}
