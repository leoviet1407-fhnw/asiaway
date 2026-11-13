'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { weekdayShort } from '@/domain/roster';
import { decideChangeAction, requestChangeAction, withdrawChangeAction } from '../../../actions';
import { useT } from '@/i18n/client';

export interface RowData {
  id: string;
  who: string;
  kind: 'SHIFT_CHANGE' | 'SHIFT_CANCEL' | 'WORKED_TIME';
  date: string;
  from: string | null;
  to: string | null;
  plan: string | null;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
}

const dm = (iso: string, lang: 'de' | 'en') => `${weekdayShort(iso, lang)} ${iso.slice(8)}.${iso.slice(5, 7)}.`;

export function ChangeForm({ shiftId, date, startMin, endMin, breakMin, label, planLabel }: { shiftId: string; date: string; startMin: number; endMin: number; breakMin: number; label: string; planLabel: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<'SHIFT_CHANGE' | 'SHIFT_CANCEL'>('SHIFT_CHANGE');
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const [from, setFrom] = useState(hm(startMin));
  const [to, setTo] = useState(hm(endMin));
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = () =>
    start(async () => {
      setMsg(null);
      const r = await requestChangeAction({ kind, shiftId, start: from, end: to, breakMin, reason });
      if (!r.ok) setMsg({ ok: false, text: r.error ?? t('Fehler') });
      else {
        setMsg({ ok: true, text: t('Angefragt. Die Leitung entscheidet.') });
        router.replace('/dienstplan/anfragen');
        router.refresh();
      }
    });

  return (
    <section className="card space-y-3">
      <h2 className="text-lg">{t('Schicht ändern')}</h2>
      <p className="text-sm">
        <span className="font-semibold text-navy">{dm(date, t.lang)} · {planLabel}</span> · {label}
      </p>
      <div className="flex gap-2">
        <button type="button" className={`chip px-3 py-1.5 ${kind === 'SHIFT_CHANGE' ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`} onClick={() => setKind('SHIFT_CHANGE')}>{t('Andere Zeiten')}</button>
        <button type="button" className={`chip px-3 py-1.5 ${kind === 'SHIFT_CANCEL' ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`} onClick={() => setKind('SHIFT_CANCEL')}>{t('Ich kann nicht')}</button>
      </div>
      {kind === 'SHIFT_CHANGE' && (
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="cr-from">{t('Beginn')}</label><input id="cr-from" inputMode="numeric" className="w-full" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="label" htmlFor="cr-to">{t('Ende')}</label><input id="cr-to" inputMode="numeric" className="w-full" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      )}
      <div>
        <label className="label" htmlFor="cr-reason">{t('Grund')}</label>
        <input id="cr-reason" className="w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('z. B. Schule, Arzttermin')} />
      </div>
      {msg && <p role="alert" className={`rounded-btn p-2 text-sm ${msg.ok ? 'bg-ok-50 text-ok-500' : 'bg-danger-50 text-danger-500'}`}>{msg.text}</p>}
      <button className="btn-primary w-full" disabled={pending} onClick={send}>{t('Änderung anfragen')}</button>
    </section>
  );
}

export function RequestRow({ row, mode, showWho }: { row: RowData; mode: 'planner' | 'own' | 'history'; showWho: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? t('Fehler'));
      else router.refresh();
    });
  const what =
    row.kind === 'SHIFT_CANCEL'
      ? t('kann nicht arbeiten')
      : row.kind === 'SHIFT_CHANGE'
        ? `${t('andere Zeit')}: ${row.from}–${row.to}`
        : `${t('Gearbeitet')}: ${row.from}–${row.to}`;
  const chip = { REQUESTED: 'bg-warn-50 text-warn-500', APPROVED: 'bg-ok-50 text-ok-500', REJECTED: 'bg-danger-50 text-danger-500', WITHDRAWN: 'bg-navy-50 text-navy' }[row.status];
  const statusText = { REQUESTED: t('offen'), APPROVED: t('genehmigt'), REJECTED: t('abgelehnt'), WITHDRAWN: t('zurückgezogen') }[row.status];
  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-navy">{showWho ? `${row.who} · ` : ''}{dm(row.date, t.lang)}{row.plan ? ` · ${t('geplant')} ${row.plan}` : ''}</div>
          <div className="text-sm text-charcoal">{what}</div>
          <div className="text-sm text-charcoal-muted">{t('Grund')}: {row.reason}</div>
        </div>
        <span className={`chip ${chip}`}>{statusText}</span>
      </div>
      {error && <p role="alert" className="text-sm text-danger-500">{error}</p>}
      {mode === 'planner' && (
        <div className="flex gap-2">
          <button className="btn-primary min-h-0 px-3 py-1.5 text-sm" disabled={pending} onClick={() => act(() => decideChangeAction(row.id, true))}>{t('Genehmigen')}</button>
          <button className="btn-secondary min-h-0 px-3 py-1.5 text-sm" disabled={pending} onClick={() => act(() => decideChangeAction(row.id, false))}>{t('Ablehnen')}</button>
        </div>
      )}
      {mode === 'own' && (
        <button className="btn-ghost min-h-0 px-2 py-1 text-sm text-brand-600" disabled={pending} onClick={() => act(() => withdrawChangeAction(row.id))}>{t('Zurückziehen')}</button>
      )}
    </li>
  );
}
