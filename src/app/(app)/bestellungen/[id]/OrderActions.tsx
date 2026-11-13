'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { OrderStatus } from '@/domain/order';
import { orderStepAction } from '../../../actions';
import { useT } from '@/i18n/client';

export function OrderActions(props: {
  orderId: string;
  status: OrderStatus;
  canSubmit: boolean;
  submitLabel: string;
  canSend: boolean;
  canReturn: boolean;
  canCancel: boolean;
  sendTo: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = (step: 'submit' | 'return' | 'cancel' | 'send', confirmText?: string, done?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      // Pending quantity changes from the editor are flushed first.
      window.dispatchEvent(new Event('aw:flush-order'));
      await new Promise((r) => setTimeout(r, 450));
      const result = await orderStepAction(props.orderId, step);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (done) setNotice(done);
      router.refresh();
    });
  };

  if (!props.canSubmit && !props.canSend && !props.canReturn && !props.canCancel) return null;

  return (
    <section className="space-y-2">
      {error && <p className="rounded-btn bg-danger-50 p-3 text-danger-500">{error}</p>}
      {notice && <p className="rounded-btn bg-ok-50 p-3 text-ok-500">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        {props.canSend && (
          <button
            className="btn-primary flex-1 sm:flex-none"
            disabled={pending}
            onClick={() => run('send', t('Bestellung jetzt per E-Mail an {to} senden?', { to: props.sendTo }), t('Bestellung gesendet.'))}
          >
            {pending ? t('Senden …') : t('An Lieferant senden')}
          </button>
        )}
        {props.canSubmit && (
          <button className="btn-primary flex-1 sm:flex-none" disabled={pending} onClick={() => run('submit', undefined, t('Zur Prüfung eingereicht.'))}>
            {props.submitLabel}
          </button>
        )}
        {props.canReturn && (
          <button className="btn-secondary" disabled={pending} onClick={() => run('return', t('Zurück an Entwurf? Die Mitarbeiter können dann wieder ändern.'))}>
            {t('Zurück an Entwurf')}
          </button>
        )}
        {props.canCancel && (
          <button className="btn-danger" disabled={pending} onClick={() => run('cancel', t('Bestellung wirklich stornieren?'))}>
            {t('Stornieren')}
          </button>
        )}
      </div>
    </section>
  );
}
