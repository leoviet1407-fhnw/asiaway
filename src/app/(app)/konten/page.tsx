import { requireAdmin } from '@/server/auth/current';
import { db } from '@/server/db';
import { listAccounts } from '@/server/services/account-service';
import { listRestaurants } from '@/server/services/catalog-service';
import { ROSTER_SITES } from '@/domain/roster';
import { AccountRow, NewAccountForm } from './AccountForms';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Mitarbeiter & Konten') };
}

export default async function AccountsPage() {
  const t = await getT();
  const p = await requireAdmin();
  const database = await db();
  const accounts = await listAccounts(database, p);
  const restaurants = (await listRestaurants(database)).map((l) => ({ id: l.id, name: l.name }));
  const sites = ROSTER_SITES.map((s) => ({ id: s.id, name: s.name }));
  const active = accounts.filter((a) => a.active);
  const inactive = accounts.filter((a) => !a.active);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl">{t('Mitarbeiter & Konten')}</h1>
        <p className="text-sm text-charcoal-muted">{t('Logins anlegen, Rechte ändern, neues Passwort, Konto abschalten. Nur Admins sehen diese Seite.')}</p>
      </div>
      <NewAccountForm restaurants={restaurants} sites={sites} />
      <section className="space-y-2">
        <h2 className="text-lg">{t('Aktive Konten')} ({active.length})</h2>
        <ul className="space-y-2">
          {active.map((a) => (
            <AccountRow key={a.id} account={a} restaurants={restaurants} self={a.id === p.userId} />
          ))}
        </ul>
      </section>
      {inactive.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg text-charcoal-muted">{t('Abgeschaltet')} ({inactive.length})</h2>
          <ul className="space-y-2">
            {inactive.map((a) => (
              <AccountRow key={a.id} account={a} restaurants={restaurants} self={false} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
