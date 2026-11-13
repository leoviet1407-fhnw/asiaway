'use client';

import { useActionState } from 'react';
import { changePasswordAction } from '../../actions';
import { useT } from '@/i18n/client';

export function PasswordForm() {
  const t = useT();
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="card space-y-3">
      <h2 className="text-lg">{t('Passwort ändern')}</h2>
      <div>
        <label className="label" htmlFor="current">{t('Aktuelles Passwort')}</label>
        <input id="current" name="current" type="password" autoComplete="current-password" required className="w-full" />
      </div>
      <div>
        <label className="label" htmlFor="next">{t('Neues Passwort (mind. 8 Zeichen)')}</label>
        <input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required className="w-full" />
      </div>
      <div>
        <label className="label" htmlFor="repeat">{t('Neues Passwort wiederholen')}</label>
        <input id="repeat" name="repeat" type="password" autoComplete="new-password" minLength={8} required className="w-full" />
      </div>
      {state?.error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">{state.error}</p>}
      {state?.saved && <p className="rounded-btn bg-ok-50 p-2 text-sm text-ok-500">{t('Passwort geändert.')}</p>}
      <button className="btn-primary" disabled={pending}>{t('Speichern')}</button>
    </form>
  );
}
