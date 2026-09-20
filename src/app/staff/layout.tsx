import Link from 'next/link';

export const dynamic = 'force-dynamic';

const LINKS = [
  { href: '/staff/schedule', label: 'My shifts' },
  { href: '/staff/availability', label: 'Availability' },
  { href: '/staff/absences', label: 'Time off' },
];

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <nav className="border-b border-surface-sunken">
        <ul className="mx-auto flex max-w-2xl gap-1 px-4">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex min-h-tap items-center px-3 text-sm text-ink hover:bg-surface-sunken"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
