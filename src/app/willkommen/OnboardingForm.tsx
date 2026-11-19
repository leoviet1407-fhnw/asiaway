'use client';

import { useActionState } from 'react';
import { saveOnboardingAction } from '../actions';
import type { OnboardingInput } from '@/domain/onboarding';
import { useT } from '@/i18n/client';

type Key = keyof OnboardingInput;

/** The personal-details form. `first` = shown at the first login (saving continues to the app). */
export function OnboardingForm({ initial, first }: { initial: OnboardingInput; first: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveOnboardingAction, undefined);
  const value = (k: Key) => state?.values?.[k] ?? initial[k];
  const err = (k: Key) => state?.errors?.[k];

  const field = (k: Key, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <div className={props.className}>
      <label className="label" htmlFor={`ob-${k}`}>{label}</label>
      <input id={`ob-${k}`} name={k} defaultValue={value(k)} className="w-full" aria-invalid={err(k) ? true : undefined} aria-describedby={err(k) ? `ob-${k}-err` : undefined} {...props} />
      {hint && !err(k) && <p className="mt-1 text-xs text-charcoal-muted">{hint}</p>}
      {err(k) && <p id={`ob-${k}-err`} role="alert" className="mt-1 text-sm text-danger-500">{err(k)}</p>}
    </div>
  );

  return (
    <form action={action} className="space-y-5" key={state?.saved ? 'saved' : 'form'}>
      {first && <input type="hidden" name="first" value="1" />}

      <section className="card space-y-3">
        <h2 className="text-lg">{t('Kontakt')}</h2>
        {field('privateEmail', t('Private E-Mail'), { type: 'email', inputMode: 'email', autoComplete: 'email', required: true, placeholder: 'name@gmail.com' })}
        {field('mobile', t('Handynummer'), { type: 'tel', inputMode: 'tel', autoComplete: 'tel', required: true, placeholder: '079 123 45 67' })}
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg">{t('Person')}</h2>
        {field('birthDate', t('Geburtsdatum'), { type: 'date', autoComplete: 'bday', required: true })}
        {field('nationality', t('Nationalität (freiwillig)'), { autoComplete: 'country-name' })}
        {field('ahvNumber', t('AHV-Nummer (freiwillig)'), { inputMode: 'numeric', placeholder: '756.1234.5678.97' })}
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg">{t('Wohnadresse')}</h2>
        {field('street', t('Strasse und Nummer'), { autoComplete: 'street-address', required: true })}
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          {field('zip', t('PLZ'), { inputMode: 'numeric', maxLength: 4, autoComplete: 'postal-code', required: true })}
          {field('city', t('Ort'), { autoComplete: 'address-level2', required: true })}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg">{t('Lohnkonto')}</h2>
        {field('iban', t('IBAN'), { autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false, required: true, placeholder: 'CH93 0076 2011 6238 5295 7' }, t('Schweizer Konto, auf Ihren Namen. Nur die Geschäftsleitung (Admin) sieht diese Angaben.'))}
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg">{t('Notfallkontakt (freiwillig)')}</h2>
        {field('emergencyName', t('Name'))}
        {field('emergencyPhone', t('Telefonnummer'), { type: 'tel', inputMode: 'tel' })}
      </section>

      {state?.error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">{state.error}</p>}
      {state?.errors && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500">{t('Bitte die markierten Felder prüfen.')}</p>}
      {state?.saved && <p className="rounded-btn bg-ok-50 p-2 text-sm text-ok-500">{t('Gespeichert.')}</p>}
      <button className="btn-primary w-full" disabled={pending}>{first ? t('Speichern und starten') : t('Speichern')}</button>
    </form>
  );
}
