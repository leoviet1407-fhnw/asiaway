'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatTime, weekdayShort } from '@/domain/roster';
import { fillGapAction } from '../../actions';
import { useT } from '@/i18n/client';

export interface GapData {
  date: string;
  service: 'LUNCH' | 'DINNER';
  missing: number;
  candidates: { userId: string; name: string; startMin: number; endMin: number; leftMinutes: number | null; worksThatDay: boolean }[];
}

/** Short services of the week and who could take them: one tap plans the person. */
export function GapPanel({ site, gaps }: { site: string; gaps: GapData[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (gaps.length === 0) return null;
  const take = (g: GapData, userId: string) =>
    start(async () => {
      setError(null);
      const r = await fillGapAction(site, g.date, g.service, userId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  const hours = (m: number) => `${Math.round((m / 60) * 10) / 10} h`;
  return (
    <section className="card space-y-3">
      <h2 className="text-lg">{t('Lücken im Plan')} <span className="chip ml-1 bg-brand-600 text-white">{gaps.reduce((n, g) => n + g.missing, 0)}</span></h2>
      <p className="text-sm text-charcoal-muted">{t('Hier fehlen Personen. Unter jeder Lücke stehen die, die frei sind. Antippen trägt sie ein.')}</p>
      {error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">{error}</p>}
      <ul className="space-y-3">
        {gaps.map((g) => (
          <li key={`${g.date}-${g.service}`} className="border-t border-surface-line pt-2">
            <div className="font-semibold text-navy">
              {weekdayShort(g.date, t.lang)} {g.date.slice(8)}.{g.date.slice(5, 7)}. · {g.service === 'LUNCH' ? t('Mittag') : t('Abend')} · <span className="text-brand-600">{t('{n} fehlt', { n: g.missing })}</span>
            </div>
            {g.candidates.length === 0 ? (
              <p className="text-sm text-charcoal-muted">{t('Niemand hat Zeit gemeldet. Aushilfen anfragen oder eine Person direkt eintragen.')}</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2">
                {g.candidates.map((c) => (
                  <button key={c.userId} type="button" disabled={pending} className="chip bg-white px-3 py-1.5 text-charcoal ring-1 ring-surface-line hover:ring-brand-600" onClick={() => take(g, c.userId)}>
                    + {c.name} · {formatTime(c.startMin)}–{formatTime(c.endMin)}
                    <span className="ml-1 text-xs text-charcoal-muted">{c.leftMinutes === null ? t('Aushilfe') : c.leftMinutes > 0 ? t('noch {h} offen', { h: hours(c.leftMinutes) }) : t('Vertrag erfüllt')}{c.worksThatDay ? ` · ${t('arbeitet schon')}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
