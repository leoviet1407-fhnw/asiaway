import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatIban } from '@/domain/onboarding';
import { isAdmin } from '@/domain/roles';
import { formatDateTime } from '@/lib/dates';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listOnboarding } from '@/server/services/onboarding-service';
import { getT } from '@/i18n/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Angaben des Teams') };
}

/** Admin only: who has filled in their personal details, and what they entered. */
export default async function TeamDetailsPage() {
  const t = await getT();
  const p = await requirePrincipal();
  if (!isAdmin(p)) redirect('/mehr');
  const rows = await listOnboarding(await db(), p);
  const missing = rows.filter((r) => !r.details).length;
  return (
    <div className="space-y-4 pb-8">
      <div>
        <Link href="/mehr" className="text-sm text-charcoal-muted hover:text-navy">{t('← Mehr')}</Link>
        <h1 className="mt-1 text-2xl">{t('Angaben des Teams')}</h1>
        <p className="text-sm text-charcoal-muted">
          {missing === 0 ? t('Alle haben ihre Angaben ausgefüllt.') : t('{n} Personen haben noch nichts ausgefüllt.', { n: missing })}
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.userId} className="card">
            <details>
              <summary className="flex cursor-pointer items-center justify-between gap-2">
                <span className="font-semibold text-navy">{r.name}</span>
                {r.details ? (
                  <span className="chip bg-ok-50 text-ok-500">{t('ausgefüllt')}</span>
                ) : (
                  <span className="chip bg-danger-50 text-danger-500">{t('fehlt noch')}</span>
                )}
              </summary>
              {r.details ? (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-charcoal-muted">{t('Private E-Mail')}</dt><dd>{r.details.privateEmail}</dd>
                  <dt className="text-charcoal-muted">{t('Handynummer')}</dt><dd>{r.details.mobile}</dd>
                  <dt className="text-charcoal-muted">{t('Geburtsdatum')}</dt><dd>{r.details.birthDate.split('-').reverse().join('.')}</dd>
                  <dt className="text-charcoal-muted">{t('Wohnadresse')}</dt><dd>{r.details.street}, {r.details.zip} {r.details.city}</dd>
                  <dt className="text-charcoal-muted">{t('Nationalität')}</dt><dd>{r.details.nationality || '–'}</dd>
                  <dt className="text-charcoal-muted">{t('AHV-Nummer')}</dt><dd>{r.details.ahvNumber || '–'}</dd>
                  <dt className="text-charcoal-muted">{t('IBAN')}</dt><dd className="font-mono">{formatIban(r.details.iban)}</dd>
                  <dt className="text-charcoal-muted">{t('Notfallkontakt')}</dt><dd>{r.details.emergencyName ? `${r.details.emergencyName}, ${r.details.emergencyPhone}` : '–'}</dd>
                  <dt className="text-charcoal-muted">{t('Zuletzt geändert')}</dt><dd>{formatDateTime(r.details.updatedAt)}</dd>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-charcoal-muted">{t('Wird beim nächsten Login abgefragt.')}</p>
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
