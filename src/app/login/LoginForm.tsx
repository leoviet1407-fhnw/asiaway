'use client';

import { useActionState } from 'react';
import { loginAction } from '../actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">
          E-Mail
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="w-full" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Passwort
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="w-full" />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? 'Anmelden …' : 'Anmelden'}
      </button>
    </form>
  );
}
