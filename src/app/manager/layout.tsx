import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * The smallest manager surface that makes the staff screens useful: open a
 * month, fill the grid, publish.
 *
 * The rest — the printable plan, month close, absence approvals and timesheet
 * review — is built, tested and still reachable by URL, just not linked. Add a
 * line here to bring one back.
 */
const LINKS = [
  { href: '/manager/roster', label: 'Roster' },
  { href: '/manager/periods', label: 'Months' },
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
