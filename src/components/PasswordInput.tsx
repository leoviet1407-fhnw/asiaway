'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Icon } from '@/components/Icon';
import { useT } from '@/i18n/client';

/** A password field with a button to show what you type (helps on a phone keyboard). */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={shown ? 'text' : 'password'} className={`${props.className ?? ''} pr-12`} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? t('Passwort verbergen') : t('Passwort anzeigen')}
        title={shown ? t('Passwort verbergen') : t('Passwort anzeigen')}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-charcoal-muted hover:text-navy"
      >
        <Icon name={shown ? 'eye-off' : 'eye'} className="h-5 w-5" />
      </button>
    </div>
  );
}
