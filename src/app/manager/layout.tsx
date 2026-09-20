import Link from 'next/link';

export const dynamic = 'force-dynamic';

const LINKS = [
  { href: '/manager/roster', label: 'Roster' },
  { href: '/manager/roster/print', label: 'Print' },
  { href: '/manager/periods', label: 'Months' },
  { href: '/manager/timesheet', label: 'Hours' },
  { href: '/manager/month-close', label: 'Month close' },
  { href: '/manager/approvals', label: 'Time off' },
];

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <nav className="border-b border-surface-sunken print:hidden">
        <ul className="mx-auto flex max-w-[1400px] gap-1 px-4">
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
