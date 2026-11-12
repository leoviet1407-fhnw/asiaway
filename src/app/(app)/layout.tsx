import Link from 'next/link';
import { isAdmin, isOrderer, roleLabel } from '@/domain/roles';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listLocations } from '@/server/services/catalog-service';
import { logoutAction } from '../actions';
import { Logo } from '@/components/Logo';
import { NavLinks } from '@/components/NavLinks';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const p = await requirePrincipal();
  const locations = await listLocations(await db());
  const scope = p.grants
    .map((g) => `${roleLabel(g.role)}${g.locationId ? ` · ${locations.find((l) => l.id === g.locationId)?.shortName ?? g.locationId}` : ''}`)
    .join(', ');
  const links = [
    { href: '/', label: 'Start', icon: 'home' as const },
    { href: '/bestellungen', label: 'Bestellen', icon: 'cart' as const },
    { href: '/wareneingang', label: 'Wareneingang', icon: 'scan' as const },
    { href: '/tagesabschluss', label: 'Abschluss', icon: 'cash' as const },
    { href: '/artikel', label: 'Artikel', icon: 'box' as const },
    ...(isOrderer(p) || isAdmin(p) ? [{ href: '/lieferanten', label: 'Lieferanten', icon: 'truck' as const }] : []),
  ];
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-30 bg-navy text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
          <Link href="/" className="flex items-center gap-2" aria-label="AsiaWay Staff – Start">
            <Logo variant="white" className="h-6" />
            <span className="text-sm text-white/70">Staff</span>
          </Link>
          <nav className="ml-6 hidden md:block">
            <NavLinks links={links} variant="top" />
          </nav>
          <div className="ml-auto flex items-center gap-2 text-right">
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-semibold">{p.name}</div>
              <div className="text-xs text-white/60">{scope}</div>
            </div>
            <form action={logoutAction}>
              <button className="btn min-h-0 px-3 py-1.5 text-sm text-white hover:bg-white/10" title="Abmelden">
                Abmelden
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <NavLinks links={links} variant="bottom" />
      </nav>
    </div>
  );
}
