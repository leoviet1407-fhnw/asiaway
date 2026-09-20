'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function WaiterLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/waiter/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        // Distinguish a genuine credential failure from a server fault. Showing
        // "incorrect password" for a 500 sends people hunting for a typo that
        // does not exist.
        const code = data?.error?.code;
        setError(
          code === 'RATE_LIMITED'
            ? 'Too many attempts. Please wait a few minutes.'
            : code === 'INVALID_CREDENTIALS'
              ? 'Email or password is incorrect.'
              : code === 'ACCOUNT_DISABLED'
                ? 'This account is disabled. Please ask your manager.'
                : 'Sign-in is temporarily unavailable. This is a problem on our side, not your password.',
        );
        return;
      }

      // Signing in is the user gesture that unlocks audio, so alert sounds work
      // for the rest of the shift.
      try {
        const ctx = new AudioContext();
        void ctx.resume();
      } catch {
        // Sound is optional; the visual alert is not.
      }

      router.push('/waiter');
      router.refresh();
    } catch {
      setError('No connection. Please check the network.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Asiaway</h1>
        <p className="text-ink-muted">Staff sign in</p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-5">
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-semibold">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-semibold">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p className="rounded-xl bg-danger-50 p-3 text-sm text-danger-500" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
