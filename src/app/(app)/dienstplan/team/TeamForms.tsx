'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { EMPLOYMENT_LABEL, ROSTER_SITES, type EmploymentType } from '@/domain/roster';
import { absenceStepAction, createStaffAction, saveBalanceAction, saveProfileAction } from '../../../actions';
import { useT } from '@/i18n/client';

const TYPES: EmploymentType[] = ['FULL_TIME', 'PART_TIME', 'ON_CALL', 'MANAGEMENT'];

export function ProfileForm({ member }: { member: { userId: string; name: string; email: string; site: string; employmentType: EmploymentType; pensumPercent: number | null; active: boolean } }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveProfileAction, undefined);
  const [type, setType] = useState<EmploymentType>(member.employmentType);
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
      <input type="hidden" name="userId" value={member.userId} />
      <input type="hidden" name="site" value={member.site} />
      <div className="col-span-2 sm:col-span-1">
        <div className="font-semibold text-navy">{member.name}</div>
        <div className="text-xs text-charcoal-muted">{member.email}</div>
      </div>
      <select name="employmentType" className="w-full" value={type} onChange={(e) => setType(e.target.value as EmploymentType)} aria-label={t('Vertrag')}>
        {TYPES.map((ty) => (
          <option key={ty} value={ty}>{t(EMPLOYMENT_LABEL[ty])}</option>
        ))}
      </select>
      {type === 'FULL_TIME' || type === 'PART_TIME' ? (
        <input name="pensum" inputMode="numeric" className="w-20" defaultValue={member.pensumPercent ?? ''} placeholder="%" aria-label={t('Pensum in Prozent')} />
      ) : (
        <span />
      )}
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" name="active" defaultChecked={member.active} className="min-h-0 accent-brand-600" /> {t('aktiv')}
      </label>
      <button className="btn-secondary min-h-0 px-3 py-1.5 text-sm" disabled={pending}>{state?.saved ? t('Gespeichert ✓') : t('Speichern')}</button>
      {state?.error && <p className="col-span-full text-sm text-danger-500">{state.error}</p>}
    </form>
  );
}

export function NewMemberForm({ site }: { site: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(createStaffAction, undefined);
  const [type, setType] = useState<EmploymentType>('PART_TIME');
  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-2">
      <h3 className="text-lg sm:col-span-2">{t('Mitarbeiter hinzufügen')}</h3>
      <input type="hidden" name="site" value={site} />
      <input type="hidden" name="active" value="on" />
      <div>
        <label className="label" htmlFor="nm-name">{t('Name')}</label>
        <input id="nm-name" name="name" required className="w-full" />
      </div>
      <div>
        <label className="label" htmlFor="nm-email">{t('E-Mail (Login)')}</label>
        <input id="nm-email" name="email" type="email" required className="w-full" />
      </div>
      <div>
        <label className="label" htmlFor="nm-type">{t('Vertrag')}</label>
        <select id="nm-type" name="employmentType" className="w-full" value={type} onChange={(e) => setType(e.target.value as EmploymentType)}>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>{t(EMPLOYMENT_LABEL[ty])}</option>
          ))}
        </select>
      </div>
      {(type === 'FULL_TIME' || type === 'PART_TIME') && (
        <div>
          <label className="label" htmlFor="nm-pensum">{t('Pensum (%)')}</label>
          <input id="nm-pensum" name="pensum" inputMode="numeric" className="w-full" defaultValue="100" />
        </div>
      )}
      {state?.error && <p role="alert" className="rounded-btn bg-danger-50 p-2 text-sm text-danger-500 sm:col-span-2">{state.error}</p>}
      {state?.password && (
        <div className="rounded-btn bg-ok-50 p-3 text-sm sm:col-span-2">
          <p className="font-semibold text-ok-500">{t('Angelegt. Login jetzt weitergeben – das Passwort wird nur einmal angezeigt:')}</p>
          <p className="mt-1 break-all font-mono">{state.email}<br />{state.password}</p>
        </div>
      )}
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{t('Anlegen')}</button>
      </div>
    </form>
  );
}

export function AbsenceDecision({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (step: 'approve' | 'reject') => start(async () => { await absenceStepAction(id, step); router.refresh(); });
  return (
    <div className="flex gap-2">
      <button className="btn-primary min-h-0 px-3 py-1.5 text-sm" disabled={pending} onClick={() => go('approve')}>{t('Genehmigen')}</button>
      <button className="btn-secondary min-h-0 px-3 py-1.5 text-sm" disabled={pending} onClick={() => go('reject')}>{t('Ablehnen')}</button>
    </div>
  );
}

export { ROSTER_SITES };

export function BalanceForm({ userId, year, vacationDays, vacationCarry, overtimeCarryHours }: { userId: string; year: number; vacationDays: number; vacationCarry: number; overtimeCarryHours: number }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveBalanceAction, undefined);
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[repeat(3,1fr)_auto]">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="year" value={year} />
      <div><label className="label" htmlFor={`vd-${userId}`}>{t('Ferientage')} {year}</label><input id={`vd-${userId}`} name="vacationDays" inputMode="decimal" className="w-full" defaultValue={vacationDays} /></div>
      <div><label className="label" htmlFor={`vc-${userId}`}>{t('Übertrag Ferien')}</label><input id={`vc-${userId}`} name="vacationCarry" inputMode="decimal" className="w-full" defaultValue={vacationCarry} /></div>
      <div><label className="label" htmlFor={`oc-${userId}`}>{t('Überstunden Vorjahr (h)')}</label><input id={`oc-${userId}`} name="overtimeCarryHours" inputMode="decimal" className="w-full" defaultValue={overtimeCarryHours} /></div>
      <button className="btn-secondary min-h-0 px-3 py-1.5 text-sm" disabled={pending}>{state?.saved ? t('Gespeichert ✓') : t('Speichern')}</button>
      {state?.error && <p className="col-span-full text-sm text-danger-500">{state.error}</p>}
    </form>
  );
}
