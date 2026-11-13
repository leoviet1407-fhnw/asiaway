'use client';

import { useActionState } from 'react';
import { completeReceiptAction } from '../../../../actions';
import { useT } from '@/i18n/client';

export function CompleteForm({ receiptId, complete }: { receiptId: string; complete: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(completeReceiptAction, undefined);
  return (
    <form action={action} className="card space-y-3">
      <input type="hidden" name="receiptId" value={receiptId} />
      <div>
        <label className="label" htmlFor="note">
          {t('Notiz zur Lieferung')}
        </label>
        <input id="note" name="note" className="w-full" maxLength={500} placeholder={t('optional, z. B. Fahrer informiert')} />
      </div>
      {state?.error && <p className="rounded-btn bg-danger-50 p-2 text-danger-500">{state.error}</p>}
      {complete ? (
        <button name="closeOrder" value="1" className="btn-primary w-full" disabled={pending}>
          {t('Lieferung abschliessen')}
        </button>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <button name="closeOrder" value="0" className="btn-primary" disabled={pending}>
            {t('Rest kommt noch – Bestellung offen lassen')}
          </button>
          <button name="closeOrder" value="1" className="btn-secondary" disabled={pending} onClick={(e) => { if (!window.confirm(t('Bestellung abschliessen? Fehlende Mengen werden nicht mehr erwartet.'))) e.preventDefault(); }}>
            {t('Abschliessen – Rest kommt nicht')}
          </button>
        </div>
      )}
    </form>
  );
}
