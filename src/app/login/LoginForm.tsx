'use client';

import { useActionState } from 'react';
import { loginAction } from '../actions';
import { useT } from '@/i18n/client';

export function LoginForm() {
  const t = useT();
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">
          {t('E-Mail')}
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="w-full" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          {t('Passwort')}
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="w-full" />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? t('Anmelden …') : t('Anmelden')}
      </button>
    </form>
  );
}
