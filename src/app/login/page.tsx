import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { LanguageSwitch } from '@/i18n/LanguageSwitch';
import { SITE_IMAGES } from '@/lib/site-images';
import { currentPrincipal } from '@/server/auth/current';
import { getDatabase } from '@/server/db';
import { LoginForm } from './LoginForm';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Anmelden') };
}
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const t = await getT();
  if (await currentPrincipal()) redirect('/');
  const { mode } = await getDatabase();
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SITE_IMAGES.dishes} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-navy/60 via-navy/75 to-navy" />
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitch dark />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6">
          <Logo variant="white" className="h-14" />
          <p className="mt-1 text-white/70">
            {t('Staff')} <span className="ml-2 text-sm text-brand-500">{t('nhân viên')}</span>
          </p>
        </div>
        <div className="rounded-btn bg-white p-6 shadow-2xl">
          <h1 className="h-site mb-4">{t('Anmelden')}</h1>
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-white/50">{t('Bestellungen · Wareneingang · Tagesabschluss')}</p>
        {mode === 'pglite' && (
          <p className="mt-4 rounded-btn bg-warn-50 p-3 text-xs text-warn-500">
            {t('Lokale Testumgebung mit')} <strong>{t('Musterdaten')}</strong>{t('. Test-Logins siehe README.')}
          </p>
        )}
      </div>
    </main>
  );
}
