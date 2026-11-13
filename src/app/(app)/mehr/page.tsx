import Link from 'next/link';
import { isAdmin, isOrderer } from '@/domain/roles';
import { Icon, type IconName } from '@/components/Icon';
import { requirePrincipal } from '@/server/auth/current';
import { logoutAction } from '../../actions';
import { PasswordForm } from './PasswordForm';

export const metadata = { title: 'Mehr' };

export default async function MorePage() {
  const p = await requirePrincipal();
  const items: { href: string; label: string; text: string; icon: IconName }[] = [
    { href: '/artikel', label: 'Artikel', text: 'Artikelliste, Barcodes, Preise', icon: 'box' },
    ...(isOrderer(p) || isAdmin(p) ? [{ href: '/lieferanten', label: 'Lieferanten', text: 'Kontakte, Liefertage, Mindestbestellung', icon: 'truck' as const }] : []),
    { href: '/dienstplan/stunden', label: 'Meine Stunden', text: 'Arbeitszeit, Überstunden, Ferien-Rest', icon: 'calendar' },
    { href: '/dienstplan/verfuegbarkeit', label: 'Verfügbarkeit & Ferien', text: 'Einen Monat im Voraus melden', icon: 'calendar' },
    ...(isOrderer(p) ? [{ href: '/dienstplan/team', label: 'Team & Meldungen', text: 'Wer hat gemeldet, Ferienanfragen, Mitarbeiter', icon: 'calendar' as const }] : []),
  ];
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl">Mehr</h1>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="card flex items-center gap-3 hover:border-brand-600">
              <Icon name={i.icon} className="h-6 w-6 text-brand-600" />
              <div>
                <div className="font-semibold text-navy">{i.label}</div>
                <div className="text-sm text-charcoal-muted">{i.text}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <PasswordForm />
      <form action={logoutAction}>
        <button className="btn-secondary w-full">Abmelden ({p.name})</button>
      </form>
    </div>
  );
}
