'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icon';

export function NavLinks({ links, variant }: { links: { href: string; label: string; icon: IconName }[]; variant: 'top' | 'bottom' }) {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  if (variant === 'top') {
    return (
      <ul className="flex gap-1">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className={`rounded-btn px-3 py-1.5 text-sm font-medium ${active(l.href) ? 'bg-white/15 text-white' : 'text-white/75 hover:text-white'}`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid" style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}>
      {links.map((l) => (
        <li key={l.href}>
          <Link
            href={l.href}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active(l.href) ? 'text-brand-600' : 'text-charcoal-muted'}`}
          >
            <Icon name={l.icon} className="h-6 w-6" />
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
