'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { belowMinimum } from '@/domain/order';
import { formatChf, formatQty, parseQty, roundQty } from '@/domain/qty';
import { Icon } from '@/components/Icon';
import { copyLastOrderAction, setQtyAction, updateOrderDetailsAction } from '../../../actions';

export interface EditorItem {
  id: string;
  nameDe: string;
  nameVi: string | null;
  sku: string;
  area: string;
  areaKey: string;
  orderUnit: string;
  priceCents: number;
  isFresh: boolean;
  isKeyItem: boolean;
  qty: number;
}

const AREA_ORDER = ['COLD', 'FREEZER', 'DRY', 'BAR'];

export function OrderEditor(props: { orderId: string; items: EditorItem[]; deliveryDate: string; note: string; minOrderCents: number; onlyOrderedInitially?: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(props.items.map((i) => [i.id, i.qty])));
  const [query, setQuery] = useState('');
  const [onlyOrdered, setOnlyOrdered] = useState(props.onlyOrderedInitially ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [deliveryDate, setDeliveryDate] = useState(props.deliveryDate);
  const [note, setNote] = useState(props.note);
  const [copying, startCopy] = useTransition();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingValues = useRef(new Map<string, number>());

  // Server refresh (e.g. after "letzte Bestellung übernehmen") replaces local values.
  useEffect(() => {
    setQty(Object.fromEntries(props.items.map((i) => [i.id, i.qty])));
  }, [props.items]);

  const save = useCallback(
    async (itemId: string, value: number) => {
      pendingValues.current.delete(itemId);
      setSaving((n) => n + 1);
      const result = await setQtyAction(props.orderId, itemId, value);
      setSaving((n) => n - 1);
      if (!result.ok) setError(result.error);
    },
    [props.orderId],
  );

  const change = (itemId: string, value: number) => {
    const v = Math.max(0, roundQty(value));
    setQty((q) => ({ ...q, [itemId]: v }));
    setError(null);
    pendingValues.current.set(itemId, v);
    const existing = timers.current.get(itemId);
    if (existing) clearTimeout(existing);
    timers.current.set(itemId, setTimeout(() => void save(itemId, v), 400));
  };

  // Submit/send flush pending changes before they act.
  useEffect(() => {
    const flush = () => {
      for (const [itemId, v] of pendingValues.current) {
        clearTimeout(timers.current.get(itemId));
        void save(itemId, v);
      }
    };
    window.addEventListener('aw:flush-order', flush);
    return () => window.removeEventListener('aw:flush-order', flush);
  }, [save]);

  const total = props.items.reduce((sum, i) => sum + Math.round((qty[i.id] ?? 0) * i.priceCents), 0);
  const count = props.items.filter((i) => (qty[i.id] ?? 0) > 0).length;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = props.items.filter(
      (i) =>
        (!onlyOrdered || (qty[i.id] ?? 0) > 0) &&
        (!q || i.nameDe.toLowerCase().includes(q) || (i.nameVi ?? '').toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)),
    );
    return AREA_ORDER.map((area) => ({ area, items: visible.filter((i) => i.areaKey === area) })).filter((g) => g.items.length > 0);
  }, [props.items, query, onlyOrdered, qty]);

  const saveDetails = async (date: string, text: string) => {
    const result = await updateOrderDetailsAction(props.orderId, date, text);
    if (!result.ok) setError(result.error);
  };

  return (
    <div className="space-y-4">
      <section className="card grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="deliveryDate">
            Gewünschte Lieferung
          </label>
          <input
            id="deliveryDate"
            type="date"
            className="w-full"
            value={deliveryDate}
            onChange={(e) => {
              setDeliveryDate(e.target.value);
              void saveDetails(e.target.value, note);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="note">
            Bemerkung an Lieferant
          </label>
          <input id="note" className="w-full" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} onBlur={() => void saveDetails(deliveryDate, note)} placeholder="optional" />
        </div>
        <button
          type="button"
          className="btn-ghost justify-start px-0 text-sm sm:col-span-2"
          disabled={copying}
          onClick={() =>
            startCopy(async () => {
              const result = await copyLastOrderAction(props.orderId);
              if (!result.ok) setError(result.error);
              else if (!result.value) setError('Keine frühere Bestellung bei diesem Lieferanten gefunden.');
              router.refresh();
            })
          }
        >
          ↺ Mengen der letzten Bestellung übernehmen
        </button>
      </section>

      <div className="sticky top-[52px] z-20 -mx-4 space-y-2 bg-surface-sunken/95 px-4 py-2 backdrop-blur">
        <input type="search" placeholder="Artikel suchen …" className="w-full" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="min-h-0 accent-brand-600" checked={onlyOrdered} onChange={(e) => setOnlyOrdered(e.target.checked)} />
          Nur bestellte Artikel zeigen
        </label>
      </div>

      {groups.map((g) => (
        <section key={g.area}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-muted">{g.items[0]!.area}</h2>
          <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
            {g.items.map((item) => (
              <ItemRow key={item.id} item={item} qty={qty[item.id] ?? 0} onChange={(v) => change(item.id, v)} />
            ))}
          </ul>
        </section>
      ))}
      {groups.length === 0 && <p className="card text-charcoal-muted">Keine Artikel gefunden.</p>}

      {error && <p className="rounded-btn bg-danger-50 p-3 text-danger-500">{error}</p>}

      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-surface-line bg-white/95 px-4 py-2 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold text-navy">{count} Positionen</span> · {formatChf(total)}
            {belowMinimum(total, props.minOrderCents) && <span className="ml-2 text-warn-500">unter Mindestbestellung {formatChf(props.minOrderCents)}</span>}
          </div>
          <span className="text-xs text-charcoal-muted">{saving > 0 ? 'Speichert …' : 'Gespeichert'}</span>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item, qty, onChange }: { item: EditorItem; qty: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const step = item.orderUnit === 'kg' ? 0.5 : 1;
  return (
    <li className={`flex items-center gap-3 px-3 py-2 ${qty > 0 ? 'bg-brand-50/40' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug text-navy">
          {item.nameDe}
          {item.isKeyItem && <span className="chip ml-1 bg-navy-50 text-[10px] text-navy">Key</span>}
          {item.isFresh && <span className="chip ml-1 bg-ok-50 text-[10px] text-ok-500">frisch</span>}
        </div>
        {item.nameVi && <div className="text-xs text-charcoal-muted">{item.nameVi}</div>}
        <div className="text-xs text-charcoal-muted">
          {item.orderUnit} · {formatChf(item.priceCents)}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="weniger" className="btn-secondary min-w-tap px-0" onClick={() => onChange(qty - step)} disabled={qty <= 0}>
          <Icon name="minus" />
        </button>
        <input
          inputMode="decimal"
          aria-label={`Menge ${item.nameDe}`}
          className="w-16 px-1 text-center font-semibold"
          value={text ?? (qty > 0 ? formatQty(qty) : '')}
          placeholder="0"
          onFocus={(e) => e.target.select()}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text !== null) {
              const v = parseQty(text);
              if (v !== null) onChange(v);
              else if (text.trim() === '') onChange(0);
            }
            setText(null);
          }}
        />
        <button type="button" aria-label="mehr" className="btn-primary min-w-tap px-0" onClick={() => onChange(qty + step)}>
          <Icon name="plus" />
        </button>
      </div>
    </li>
  );
}
