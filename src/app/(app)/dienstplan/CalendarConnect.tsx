'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Icon } from '@/components/Icon';
import { useT } from '@/i18n/client';
import { resetCalendarAction } from '../../actions';

/** Subscribe to one's own shifts in Apple Calendar (webcal) or copy the link for Google Calendar. */
export function CalendarConnect({ httpsUrl }: { httpsUrl: string }) {
  const t = useT();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const webcal = httpsUrl.replace(/^https?:\/\//, 'webcal://');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      window.prompt(t('Link kopieren'), httpsUrl);
    }
  };
  return (
    <details className="card">
      <summary className="flex cursor-pointer items-center gap-2 text-lg font-semibold text-navy">
        <Icon name="calendar" className="h-5 w-5" /> {t('Schichten im Kalender')}
      </summary>
      <p className="mt-2 text-sm text-charcoal-muted">{t('Einmal verbinden: Ihre veröffentlichten Schichten erscheinen im Kalender auf dem Handy und werden bei Änderungen automatisch aktualisiert.')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={webcal} className="btn-primary min-h-0 gap-2 px-4 py-2">
          <Icon name="calendar" className="h-4 w-4" /> {t('Zu Apple Kalender hinzufügen')}
        </a>
        <button type="button" className="btn-secondary min-h-0 gap-2 px-4 py-2" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} className="h-4 w-4" /> {copied ? t('Kopiert') : t('Link für Google Kalender kopieren')}
        </button>
      </div>
      <p className="mt-3 text-xs text-charcoal-muted">
        {t('Google Kalender: am Computer unter „Weitere Kalender“ → „Per URL“ den Link einfügen.')}{' '}
        {t('Der Link ist persönlich – nicht weitergeben.')}{' '}
        <button
          type="button"
          className="text-brand-600 underline"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t('Neuen Link erstellen? Der alte Link funktioniert dann nicht mehr; im Kalender neu verbinden.'))) return;
            start(async () => {
              await resetCalendarAction();
              router.refresh();
            });
          }}
        >
          {t('Link erneuern')}
        </button>
      </p>
    </details>
  );
}
