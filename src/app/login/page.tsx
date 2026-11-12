import { redirect } from 'next/navigation';
import { currentPrincipal } from '@/server/auth/current';
import { getDatabase } from '@/server/db';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Anmelden' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentPrincipal()) redirect('/');
  const { mode } = await getDatabase();
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy p-4">
      <div className="w-full max-w-sm rounded-btn bg-white p-6 shadow-xl">
        <div className="mb-6">
          <div className="text-2xl font-bold text-navy">
            Asia<span className="text-brand-600">Way</span> Staff
          </div>
          <p className="text-sm text-charcoal-muted">Bestellungen & Wareneingang</p>
        </div>
        <LoginForm />
        {mode === 'pglite' && (
          <p className="mt-6 rounded-btn bg-warn-50 p-3 text-xs text-warn-500">
            Lokale Testumgebung mit <strong>Musterdaten</strong>. Test-Logins siehe README.
          </p>
        )}
      </div>
    </main>
  );
}
