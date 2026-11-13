'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatQty, parseQty, roundQty } from '@/domain/qty';
import { ScanDebouncer, computeDiscrepancies, interpretScan, type LineStatus } from '@/domain/receiving';
import { Icon } from '@/components/Icon';
import { PhotoButton } from '@/components/PhotoButton';
import { Scanner } from '@/components/Scanner';
import { LineStatusChip } from '@/components/StatusChip';
import { syncReceiptAction } from '../../../actions';
import { useT } from '@/i18n/client';

export interface ReceiverLine {
  itemId: string;
  nameDe: string;
  nameVi: string | null;
  area: string;
  isFresh: boolean;
  orderUnit: string;
  ordered: number;
  before: number;
  expectedNow: number;
  hasBarcode: boolean;
}

interface Entry {
  itemId: string | null;
  scannedCode: string | null;
  qty: number;
  damaged: boolean;
  note: string | null;
}

interface Props {
  receiptId: string;
  title: string;
  subtitle: string;
  lines: ReceiverLine[];
  current: Entry[];
  barcodes: { code: string; itemId: string; unitsPerScan: number }[];
  itemNames: Record<string, { nameDe: string; stockUnit: string }>;
  photoCount: { DELIVERY_NOTE: number; DAMAGE: number };
}

type Feedback = { tone: 'ok' | 'warn' | 'error'; text: string; key: string | null; at: number };

const keyOf = (e: { itemId: string | null; scannedCode: string | null }) => e.itemId ?? `code:${e.scannedCode}`;

function beep(ok: boolean) {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1200 : 300;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    osc.onended = () => void ctx.close();
  } catch {
    // No sound available.
  }
  navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
}

export function Receiver(props: Props) {
  const t = useT();
  const router = useRouter();
  const storageKey = `aw-receipt-${props.receiptId}`;
  const [entries, setEntries] = useState<Record<string, Entry>>(() => Object.fromEntries(props.current.map((e) => [keyOf(e), e])));
  const [dirty, setDirty] = useState(false);
  const [syncState, setSyncState] = useState<'saved' | 'saving' | 'offline' | 'error'>('saved');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [photos, setPhotos] = useState(props.photoCount);
  const version = useRef(0);
  const debouncer = useRef(new ScanDebouncer(1500));

  // Restore unsynced work kept on this phone (e.g. after losing signal and reloading).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { entries: Record<string, Entry>; dirty: boolean };
      if (saved.dirty) {
        setEntries(saved.entries);
        setDirty(true);
      }
    } catch {
      // Storage unavailable or corrupt: the server copy stands.
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ entries, dirty }));
    } catch {
      // Private mode: no local copy, sync still works.
    }
  }, [entries, dirty, storageKey]);

  const sync = useCallback(async () => {
    const mine = version.current;
    setSyncState('saving');
    try {
      const result = await syncReceiptAction(props.receiptId, Object.values(entries));
      if (!result.ok) {
        setSyncState('error');
        setSyncError(result.error);
        return false;
      }
      if (version.current === mine) setDirty(false);
      setSyncState('saved');
      setSyncError(null);
      return true;
    } catch {
      setSyncState('offline');
      return false;
    }
  }, [entries, props.receiptId]);

  // Save shortly after each change; retry every 5 s while offline.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void sync(), syncState === 'offline' ? 5000 : 700);
    return () => clearTimeout(t);
  }, [dirty, entries, sync, syncState]);

  useEffect(() => {
    const online = () => dirty && void sync();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [dirty, sync]);

  const update = (key: string, base: Omit<Entry, 'qty' | 'damaged' | 'note'>, patch: Partial<Entry>) => {
    version.current += 1;
    setEntries((all) => {
      const prev = all[key] ?? { ...base, qty: 0, damaged: false, note: null };
      const next = { ...prev, ...patch };
      next.qty = Math.max(0, roundQty(next.qty));
      return { ...all, [key]: next };
    });
    setDirty(true);
  };

  const byItem = useMemo(() => new Map(props.lines.map((l) => [l.itemId, l])), [props.lines]);
  const codeMap = useMemo(() => new Map(props.barcodes.map((b) => [b.code, { itemId: b.itemId, unitsPerScan: b.unitsPerScan }])), [props.barcodes]);
  const orderIds = useMemo(() => new Set(props.lines.map((l) => l.itemId)), [props.lines]);

  const handleCode = useCallback(
    (raw: string, fromCamera: boolean) => {
      const code = raw.trim();
      if (fromCamera && !debouncer.current.accept(code, Date.now())) return;
      const result = interpretScan(code, codeMap, orderIds);
      const at = Date.now();
      if (result.kind === 'invalid') {
        if (!fromCamera) {
          beep(false);
          setFeedback({ tone: 'error', text: t('Ungültiger Barcode {code} (Prüfziffer)', { code: result.code }), key: null, at });
        }
        return;
      }
      if (result.kind === 'unknown') {
        beep(false);
        const key = `code:${result.code}`;
        setEntries((all) => {
          const prev = all[key];
          return { ...all, [key]: { itemId: null, scannedCode: result.code, qty: roundQty((prev?.qty ?? 0) + 1), damaged: prev?.damaged ?? false, note: prev?.note ?? null } };
        });
        version.current += 1;
        setDirty(true);
        setFeedback({ tone: 'error', text: t('Unbekannter Barcode {code}', { code: result.code }), key, at });
        return;
      }
      const line = byItem.get(result.itemId);
      setEntries((all) => {
        const prev = all[result.itemId];
        return { ...all, [result.itemId]: { itemId: result.itemId, scannedCode: null, qty: roundQty((prev?.qty ?? 0) + result.add), damaged: prev?.damaged ?? false, note: prev?.note ?? null } };
      });
      version.current += 1;
      setDirty(true);
      const name = line?.nameDe ?? props.itemNames[result.itemId]?.nameDe ?? t('Artikel');
      if (!result.onOrder) {
        beep(false);
        setFeedback({ tone: 'warn', text: t('Nicht bestellt: {name}', { name }), key: result.itemId, at });
      } else {
        beep(true);
        const current = roundQty((entries[result.itemId]?.qty ?? 0) + result.add);
        const over = line && current > line.expectedNow + 0.0005;
        setFeedback({
          tone: over ? 'warn' : 'ok',
          text: `${name} +${formatQty(result.add)} → ${formatQty(current)} / ${formatQty(line?.expectedNow ?? 0)}${over ? ` (${t('zu viel')})` : ''}`,
          key: result.itemId,
          at,
        });
      }
    },
    [byItem, codeMap, orderIds, props.itemNames, entries],
  );

  const rows = useMemo(
    () =>
      computeDiscrepancies(
        props.lines.map((l) => ({ itemId: l.itemId, qty: l.ordered, isFresh: l.isFresh })),
        new Map(props.lines.map((l) => [l.itemId, l.before])),
        Object.values(entries),
      ),
    [entries, props.lines],
  );
  const statusOf = new Map(rows.map((r) => [r.key, r.status]));
  const doneCount = rows.filter((r) => r.onOrder && (r.status === 'OK' || r.status === 'EXTRA')).length;
  const extras = Object.entries(entries).filter(([key, e]) => !orderIds.has(key) && e.qty > 0);
  const areas = [...new Set(props.lines.map((l) => l.area))];

  const finish = async () => {
    if (dirty && !(await sync())) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    router.push(`/wareneingang/${props.receiptId}/abweichungen`);
  };

  return (
    <div className="space-y-3 pb-32">
      <div>
        <h1 className="text-xl">{props.title}</h1>
        <p className="text-sm text-charcoal-muted">{props.subtitle}</p>
      </div>

      <Scanner onCode={(c) => handleCode(c, true)} />

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) handleCode(manual, false);
          setManual('');
        }}
      >
        <input inputMode="numeric" placeholder={t('Barcode eintippen oder Hand-Scanner')} className="min-w-0 flex-1" value={manual} onChange={(e) => setManual(e.target.value)} aria-label={t('Barcode manuell')} />
        <button className="btn-secondary">{t('OK')}</button>
      </form>

      {feedback && (
        <div
          key={feedback.at}
          role="status"
          className={`rounded-btn p-3 text-sm font-semibold ${feedback.tone === 'ok' ? 'bg-ok-50 text-ok-500' : feedback.tone === 'warn' ? 'bg-warn-50 text-warn-500' : 'bg-danger-50 text-danger-500'}`}
        >
          {feedback.text}
        </div>
      )}

      {syncState === 'offline' && (
        <div className="rounded-btn bg-warn-50 p-3 text-sm text-warn-500">{t('Offline – alles bleibt auf dem Telefon gespeichert und wird gesendet, sobald Verbindung da ist.')}</div>
      )}
      {syncState === 'error' && syncError && <div className="rounded-btn bg-danger-50 p-3 text-sm text-danger-500">{syncError}</div>}

      <div className="flex gap-2">
        <PhotoButton receiptId={props.receiptId} kind="DELIVERY_NOTE" label={`${t('Lieferschein')}${photos.DELIVERY_NOTE ? ` (${photos.DELIVERY_NOTE})` : ''}`} onUploaded={() => setPhotos((p) => ({ ...p, DELIVERY_NOTE: p.DELIVERY_NOTE + 1 }))} />
        <PhotoButton receiptId={props.receiptId} kind="DAMAGE" label={`${t('Schaden')}${photos.DAMAGE ? ` (${photos.DAMAGE})` : ''}`} onUploaded={() => setPhotos((p) => ({ ...p, DAMAGE: p.DAMAGE + 1 }))} />
      </div>

      {areas.map((area) => (
        <section key={area}>
          <h2 className="mb-1 mt-2 text-sm font-semibold uppercase tracking-wide text-charcoal-muted">{area}</h2>
          <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
            {props.lines
              .filter((l) => l.area === area)
              .map((line) => {
                const entry = entries[line.itemId];
                const qty = entry?.qty ?? 0;
                const status = statusOf.get(line.itemId) ?? 'MISSING';
                const highlight = feedback?.key === line.itemId && Date.now() - feedback.at < 4000;
                return (
                  <li key={line.itemId} className={highlight ? 'bg-ok-50' : ''}>
                    <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left" onClick={() => setOpen(open === line.itemId ? null : line.itemId)}>
                      <StatusDot status={qty === 0 && line.expectedNow > 0 ? null : status} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-snug text-navy">{line.nameDe}</div>
                        <div className="text-xs text-charcoal-muted">
                          {line.orderUnit}
                          {line.isFresh ? ` · ${t('frisch – antippen')}` : line.hasBarcode ? '' : ` · ${t('ohne Barcode – antippen')}`}
                          {line.before > 0 && ` · ${t('früher geliefert')} ${formatQty(line.before)}`}
                          {entry?.damaged && <span className="ml-1 font-semibold text-brand-600">{t('· beschädigt')}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-navy">
                          {formatQty(qty)}
                          <span className="text-sm font-normal text-charcoal-muted"> / {formatQty(line.expectedNow)}</span>
                        </div>
                      </div>
                    </button>
                    {open === line.itemId && (
                      <LinePanel
                        line={line}
                        entry={entry}
                        onSet={(patch) => update(line.itemId, { itemId: line.itemId, scannedCode: null }, patch)}
                      />
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      {extras.length > 0 && (
        <section>
          <h2 className="mb-1 mt-2 text-sm font-semibold uppercase tracking-wide text-brand-600">{t('Nicht bestellt / unbekannt')}</h2>
          <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-brand-600/40 bg-white">
            {extras.map(([key, e]) => (
              <li key={key} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-navy">{e.itemId ? props.itemNames[e.itemId]?.nameDe ?? t('Artikel') : t('Unbekannter Barcode')}</div>
                  <div className="text-xs text-charcoal-muted">{e.itemId ? t('nicht auf dieser Bestellung') : e.scannedCode}</div>
                </div>
                <Stepper value={e.qty} onChange={(v) => update(key, { itemId: e.itemId, scannedCode: e.scannedCode }, { qty: v })} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-surface-line bg-white/95 px-4 py-2 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="flex-1 text-sm">
            <div className="font-semibold text-navy">
              {doneCount} / {props.lines.length} {t('vollständig')}
            </div>
            <div className="text-xs text-charcoal-muted">
              {syncState === 'saving' ? t('Speichert …') : syncState === 'offline' ? t('Offline – lokal gespeichert') : dirty ? t('Ungespeichert') : t('Gespeichert')}
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={() => void finish()}>
            {t('Prüfen & abschliessen')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: LineStatus | null }) {
  const t = useT();
  if (status === null) return <span className="h-3 w-3 shrink-0 rounded-full border-2 border-charcoal-muted/40" aria-label={t('offen')} />;
  const color: Record<LineStatus, string> = { OK: 'bg-ok-500', SHORT: 'bg-brand-500', MISSING: 'bg-brand-600', EXTRA: 'bg-warn-500', WRONG: 'bg-navy' };
  return <span className={`h-3 w-3 shrink-0 rounded-full ${color[status]}`} aria-label={status} />;
}

function Stepper({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={t('weniger')} className="btn-secondary min-w-tap px-0" onClick={() => onChange(value - step)} disabled={value <= 0}>
        <Icon name="minus" />
      </button>
      <input
        inputMode="decimal"
        className="w-16 px-1 text-center font-semibold"
        value={text ?? formatQty(value)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            const v = parseQty(text);
            if (v !== null) onChange(v);
          }
          setText(null);
        }}
        aria-label={t('Menge')}
      />
      <button type="button" aria-label={t('mehr')} className="btn-primary min-w-tap px-0" onClick={() => onChange(value + step)}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

function LinePanel({ line, entry, onSet }: { line: ReceiverLine; entry: Entry | undefined; onSet: (patch: Partial<Entry>) => void }) {
  const t = useT();
  const qty = entry?.qty ?? 0;
  const step = line.orderUnit === 'kg' ? 0.1 : 1;
  return (
    <div className="space-y-3 border-t border-surface-line bg-surface-sunken px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary flex-1" onClick={() => onSet({ qty: line.expectedNow })}>
          <Icon name="check" /> {t('Wie bestellt (')}{formatQty(line.expectedNow)})
        </button>
        <button type="button" className="btn-secondary" onClick={() => onSet({ qty: 0 })}>
          {t('Nicht geliefert')}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-navy">{line.orderUnit === 'kg' ? t('Gewicht (kg)') : `${t('Menge')} (${line.orderUnit})`}</span>
        <Stepper value={qty} step={step} onChange={(v) => onSet({ qty: v })} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="min-h-0 accent-brand-600" checked={entry?.damaged ?? false} onChange={(e) => onSet({ damaged: e.target.checked })} />
        {t('Beschädigt / Qualität mangelhaft')}
      </label>
      {(entry?.damaged || entry?.note) && (
        <input className="w-full" placeholder={t('Notiz (z. B. 2 Dosen verbeult)')} defaultValue={entry?.note ?? ''} maxLength={500} onBlur={(e) => onSet({ note: e.target.value || null })} />
      )}
    </div>
  );
}
