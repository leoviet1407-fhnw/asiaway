import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SITE_IMAGES } from '@/lib/site-images';
import { currentPrincipal } from '@/server/auth/current';
import { getDatabase } from '@/server/db';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Anmelden' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentPrincipal()) redirect('/');
  const { mode } = await getDatabase();
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SITE_IMAGES.dishes} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-navy/60 via-navy/75 to-navy" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6">
          <Logo variant="white" className="h-14" />
          <p className="mt-1 text-white/70">
            Staff <span className="ml-2 text-sm text-brand-500">nhân viên</span>
          </p>
        </div>
        <div className="rounded-btn bg-white p-6 shadow-2xl">
          <h1 className="h-site mb-4">Anmelden</h1>
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-white/50">Bestellungen · Wareneingang · Tagesabschluss</p>
        {mode === 'pglite' && (
          <p className="mt-4 rounded-btn bg-warn-50 p-3 text-xs text-warn-500">
            Lokale Testumgebung mit <strong>Musterdaten</strong>. Test-Logins siehe README.
          </p>
        )}
      </div>
    </main>
  );
}
