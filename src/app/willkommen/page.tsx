import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { LanguageSwitch } from '@/i18n/LanguageSwitch';
import { getT } from '@/i18n/server';
import type { OnboardingInput } from '@/domain/onboarding';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getMyOnboarding } from '@/server/services/onboarding-service';
import { logoutAction } from '../actions';
import { OnboardingForm } from './OnboardingForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Meine Angaben') };
}

const EMPTY: OnboardingInput = { privateEmail: '', mobile: '', birthDate: '', street: '', zip: '', city: '', nationality: '', iban: '', ahvNumber: '', emergencyName: '', emergencyPhone: '' };

/**
 * Personal details. Shown on its own (no menu) until a person has filled it in for the
 * first time; afterwards reachable from "Mehr" to change them.
 */
export default async function WelcomePage() {
  const t = await getT();
  const p = await requirePrincipal();
  const existing = await getMyOnboarding(await db(), p);
  const first = !existing;
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Logo variant="red" className="h-8" />
        <LanguageSwitch />
      </div>
      {first ? (
        <div>
          <h1 className="text-2xl">{t('Hallo {name}', { name: p.name })}</h1>
          <p className="mt-1 text-charcoal-muted">{t('Bevor es losgeht: Bitte ergänzen Sie einmalig Ihre persönlichen Angaben. Wir brauchen sie für den Vertrag und die Lohnzahlung.')}</p>
        </div>
      ) : (
        <div>
          <Link href="/mehr" className="text-sm text-charcoal-muted hover:text-navy">{t('← Mehr')}</Link>
          <h1 className="mt-1 text-2xl">{t('Meine Angaben')}</h1>
        </div>
      )}
      <OnboardingForm initial={existing ?? EMPTY} first={first} />
      {first && (
        <form action={logoutAction}>
          <button className="btn-secondary w-full">{t('Abmelden')}</button>
        </form>
      )}
    </main>
  );
}
