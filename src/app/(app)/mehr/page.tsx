import Link from 'next/link';
import { isAdmin, isOrderer, isPlanner } from '@/domain/roles';
import { Icon, type IconName } from '@/components/Icon';
import { requirePrincipal } from '@/server/auth/current';
import { logoutAction } from '../../actions';
import { PasswordForm } from './PasswordForm';
import { LanguageSwitch } from '@/i18n/LanguageSwitch';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Mehr') };
}

export default async function MorePage() {
  const t = await getT();
  const p = await requirePrincipal();
  const items: { href: string; label: string; text: string; icon: IconName }[] = [
    { href: '/artikel', label: t('Artikel'), text: t('Artikelliste, Barcodes, Preise'), icon: 'box' },
    ...(isOrderer(p) || isAdmin(p) ? [{ href: '/lieferanten', label: t('Lieferanten'), text: t('Kontakte, Liefertage, Mindestbestellung'), icon: 'truck' as const }] : []),
    { href: '/dienstplan/stunden', label: t('Meine Stunden'), text: t('Arbeitszeit, Überstunden, Ferien-Rest'), icon: 'clock' as const },
    { href: '/dienstplan/verfuegbarkeit', label: t('Verfügbarkeit & Ferien'), text: t('Wann Sie arbeiten können, Ferien'), icon: 'sun' as const },
    ...(isPlanner(p) ? [{ href: '/dienstplan/bedarf', label: t('Bedarf & Abdeckung'), text: t('Wie viele Personen gebraucht werden und wie viele gemeldet haben'), icon: 'chart' as const }] : []),
    ...(isPlanner(p) ? [{ href: '/dienstplan/saison', label: t('Feiertage & Ferienzeit'), text: t('Besondere Tage, Ferien-Limiten'), icon: 'sun' as const }] : []),
    ...(isPlanner(p) ? [{ href: '/dienstplan/uebersicht', label: t('Übersicht'), text: t('Alle Mitarbeiter, Diagramme zu Stunden, Ferien und Umsatz'), icon: 'chart' as const }] : []),
    ...(isPlanner(p) ? [{ href: '/dienstplan/team', label: t('Team & Meldungen'), text: t('Wer hat gemeldet, Ferienanfragen, Mitarbeiter'), icon: 'users' as const }] : []),
  ];
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl">{t('Mehr')}</h1>
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
      <div className="card flex items-center justify-between gap-3">
        <span className="font-semibold text-navy">Deutsch / English</span>
        <LanguageSwitch />
      </div>
      <PasswordForm />
      <form action={logoutAction}>
        <button className="btn-secondary w-full">{t('Abmelden (')}{p.name})</button>
      </form>
    </div>
  );
}
