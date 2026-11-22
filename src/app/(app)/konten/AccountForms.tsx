'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EMPLOYMENT_LABEL, type EmploymentType } from '@/domain/roster';
import type { Account } from '@/server/services/account-service';
import { createAccountAction, resetAccountPasswordAction, setAccountActiveAction, updateAccountAction } from '../../actions';
import { useT } from '@/i18n/client';

type Option = { id: string; name: string };
const TYPES: EmploymentType[] = ['FULL_TIME', 'PART_TIME', 'ON_CALL', 'MANAGEMENT'];

/** Restaurants and rights as checkboxes (same fields in the new and the edit form). */
function Rights({ restaurants, account, prefix }: { restaurants: Option[]; account?: Account; prefix: string }) {
  const t = useT();
  return (
    <>
      <fieldset className="sm:col-span-2">
        <legend className="label">{t('Arbeitet in')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {restaurants.map((r) => (
            <label key={r.id} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="location" value={r.id} defaultChecked={account?.locationIds.includes(r.id)} className="min-h-0 accent-brand-600" id={`${prefix}-loc-${r.id}`} />
              {r.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="label">{t('Rechte')}</legend>
        <div className="grid gap-1 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="orderer" defaultChecked={account?.orderer} className="min-h-0 accent-brand-600" />
            {t('Bestellungen freigeben und senden, Artikel & Lieferanten pflegen')}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="planner" defaultChecked={account?.planner} className="min-h-0 accent-brand-600" />
            {t('Dienstplan planen, Ferien und Änderungen bewilligen')}
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="admin" defaultChecked={account?.admin} className="min-h-0 accent-brand-600" />
            {t('Admin (alles, auch Konten und Lohnangaben)')}
          </label>
        </div>
      </fieldset>
    </>
  );
}

function PasswordNote({ email, password }: { email: string; password: string }) {
  const t = useT();
  return (
    <div className="rounded-btn bg-ok-50 p-3 text-sm sm:col-span-2">
      <p className="font-semibold text-ok-500">{t('Login jetzt weitergeben – das Passwort wird nur einmal angezeigt:')}</p>
      <p className="mt-1 break-all font-mono text-navy">
        {email}
        <br />
        {password}
      </p>
    </div>
  );
}

export function NewAccountForm({ restaurants, sites }: { restaurants: Option[]; sites: Option[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(createAccountAction, undefined);
  const [site, setSite] = useState('');
  const [type, setType] = useState<EmploymentType>('PART_TIME');
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        {t('+ Neuer Mitarbeiter / neues Konto')}
      </button>
    );
  }
  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-2">
      <h2 className="text-lg sm:col-span-2">{t('Neues Konto')}</h2>
      <div>
        <label className="label" htmlFor="na-name">{t('Name')}</label>
        <input id="na-name" name="name" required className="w-full" />
      </div>
      <div>
        <label className="label" htmlFor="na-email">{t('E-Mail (Login)')}</label>
        <input id="na-email" name="email" type="email" required className="w-full" autoComplete="off" />
      </div>
      <Rights restaurants={restaurants} prefix="na" />
      <div>
        <label className="label" htmlFor="na-site">{t('Im Dienstplan')}</label>
        <select id="na-site" name="rosterSite" className="w-full" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">{t('Nein (nur Login, z. B. Küche bestellt)')}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      {site && (
        <div>
          <label className="label" htmlFor="na-type">{t('Vertrag')}</label>
          <select id="na-type" name="employmentType" className="w-full" value={type} onChange={(e) => setType(e.target.value as EmploymentType)}>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>{t(EMPLOYMENT_LABEL[ty])}</option>
            ))}
          </select>
        </div>
      )}
      {site && (type === 'FULL_TIME' || type === 'PART_TIME') && (
        <div>
          <label className="label" htmlFor="na-pensum">{t('Pensum (%)')}</label>
          <input id="na-pensum" name="pensum" inputMode="numeric" className="w-full" defaultValue="100" />
        </div>
      )}
      {site && <p className="text-xs text-charcoal-muted sm:col-span-2">{t('Ohne gewählte Restaurants arbeitet die Person in allen Restaurants dieses Standorts.')}</p>}
      {state?.error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500 sm:col-span-2">{state.error}</p>}
      {state?.password && state.email && <PasswordNote email={state.email} password={state.password} />}
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? t('Speichert …') : t('Anlegen')}</button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>{t('Schliessen')}</button>
      </div>
    </form>
  );
}

export function AccountRow({ account: a, restaurants, self }: { account: Account; restaurants: Option[]; self: boolean }) {
  const t = useT();
  const router = useRouter();
  const [state, action, pending] = useActionState(updateAccountAction, undefined);
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; password?: string } | null>(null);
  const tags = [
    ...a.locationIds.map((id) => restaurants.find((r) => r.id === id)?.name ?? id),
    a.orderer ? t('Bestellungen') : null,
    a.planner ? t('Dienstplan') : null,
    a.admin ? t('Admin') : null,
  ].filter(Boolean);

  // Asked on the page itself: browser pop-ups (confirm) are blocked in some phone browsers and home-screen apps.
  const [ask, setAsk] = useState<'off' | 'reset' | null>(null);
  const run = (job: () => Promise<void>) =>
    start(async () => {
      try {
        await job();
      } catch {
        setMessage({ error: t('Keine Verbindung oder die Seite ist veraltet. Bitte Seite neu laden und nochmals versuchen.') });
      }
    });
  const reset = () =>
    run(async () => {
      setAsk(null);
      const r = await resetAccountPasswordAction(a.id);
      setMessage(r.ok ? { password: r.value } : { error: r.error });
    });
  const toggle = () =>
    run(async () => {
      setAsk(null);
      setMessage(null);
      const r = await setAccountActiveAction(a.id, !a.active);
      if (!r.ok) setMessage({ error: r.error });
      else router.refresh();
    });

  return (
    <li>
      <details className={`card ${a.active ? '' : 'opacity-70'}`}>
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
          <span>
            <span className="font-semibold text-navy">{a.name}</span>
            {self && <span className="ml-1 text-xs text-charcoal-muted">({t('Sie')})</span>}
            <span className="block break-all text-xs text-charcoal-muted">{a.email}</span>
          </span>
          <span className="flex flex-wrap gap-1">
            {tags.map((x) => (
              <span key={x} className="chip bg-navy-50 text-[11px] text-navy">{x}</span>
            ))}
            {a.rosterSite && <span className="chip bg-ok-50 text-[11px] text-ok-500">{t('im Dienstplan')}</span>}
          </span>
        </summary>
        <form action={action} className="mt-3 grid gap-3 border-t border-surface-line pt-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={a.id} />
          <div>
            <label className="label" htmlFor={`n-${a.id}`}>{t('Name')}</label>
            <input id={`n-${a.id}`} name="name" defaultValue={a.name} required className="w-full" />
          </div>
          <div>
            <label className="label" htmlFor={`e-${a.id}`}>{t('E-Mail (Login)')}</label>
            <input id={`e-${a.id}`} name="email" type="email" defaultValue={a.email} required className="w-full" />
          </div>
          <Rights restaurants={restaurants} account={a} prefix={a.id} />
          {state?.error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500 sm:col-span-2">{state.error}</p>}
          {state?.saved && <p className="rounded-btn bg-ok-50 p-2 text-sm text-ok-500 sm:col-span-2">{t('Gespeichert.')}</p>}
          {message?.error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500 sm:col-span-2">{message.error}</p>}
          {message?.password && <PasswordNote email={a.email} password={message.password} />}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={pending}>{pending ? t('Speichert …') : t('Speichern')}</button>
            {a.active && (
              <button type="button" className="btn-secondary" onClick={() => setAsk('reset')} disabled={busy}>{t('Neues Passwort')}</button>
            )}
            {!self && (
              <button type="button" className={a.active ? 'btn-secondary text-danger-500' : 'btn-secondary'} onClick={() => (a.active ? setAsk('off') : toggle())} disabled={busy}>
                {busy ? t('Speichert …') : a.active ? t('Konto abschalten') : t('Wieder einschalten')}
              </button>
            )}
          </div>
          {self && <p className="text-xs text-charcoal-muted sm:col-span-2">{t('Das eigene Konto kann man nicht abschalten.')}</p>}
          {ask && (
            <div role="alertdialog" className="rounded-btn border-2 border-brand-600 bg-danger-50 p-3 text-sm sm:col-span-2">
              <p className="font-semibold text-navy">
                {ask === 'off'
                  ? t('{name} abschalten? Die Person kann sich nicht mehr anmelden und wird nicht mehr geplant. Bestellungen, Schichten und Abschlüsse bleiben erhalten.', { name: a.name })
                  : t('Neues Passwort für {name} erstellen? Das alte gilt dann nicht mehr.', { name: a.name })}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn-primary min-h-0 px-3 py-1.5" onClick={ask === 'off' ? toggle : reset} disabled={busy}>
                  {ask === 'off' ? t('Ja, abschalten') : t('Ja, neues Passwort')}
                </button>
                <button type="button" className="btn-secondary min-h-0 px-3 py-1.5" onClick={() => setAsk(null)}>{t('Abbrechen')}</button>
              </div>
            </div>
          )}
          {a.rosterSite && <p className="text-xs text-charcoal-muted sm:col-span-2">{t('Pensum, Vertrag und letzter Arbeitstag: unter Dienstplan → Team & Meldungen.')}</p>}
        </form>
      </details>
    </li>
  );
}
