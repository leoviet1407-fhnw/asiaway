import Link from 'next/link';
import { formatChf } from '@/domain/qty';
import { isAdmin } from '@/domain/roles';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { listItems, listSuppliers } from '@/server/services/catalog-service';

export const metadata = { title: 'Lieferanten' };

const CHANNEL: Record<string, string> = { EMAIL: 'E-Mail', WHATSAPP: 'WhatsApp', PORTAL: 'Portal' };

export default async function SuppliersPage() {
  const p = await requirePrincipal();
  const database = await db();
  const suppliers = await listSuppliers(database, { includeInactive: isAdmin(p) });
  const items = await listItems(database);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl">Lieferanten</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {suppliers.map((s) => {
          const count = items.filter((i) => i.offers.some((o) => o.supplierId === s.id)).length;
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className={`font-semibold text-navy ${s.active ? '' : 'line-through opacity-60'}`}>{s.name}</div>
                <span className="chip bg-navy-50 text-navy">{CHANNEL[s.orderChannel]}</span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                <dt className="text-charcoal-muted">Bestellung an</dt>
                <dd className="break-all">{s.orderEmail}</dd>
                {s.phone && (
                  <>
                    <dt className="text-charcoal-muted">Telefon</dt>
                    <dd>{s.phone}</dd>
                  </>
                )}
                <dt className="text-charcoal-muted">Liefertage</dt>
                <dd>{s.deliveryDays || '–'}</dd>
                <dt className="text-charcoal-muted">Mindestbest.</dt>
                <dd>{s.minOrderCents > 0 ? formatChf(s.minOrderCents) : '–'}</dd>
                <dt className="text-charcoal-muted">Kunden-Nr.</dt>
                <dd>{s.customerNumber ?? '–'}</dd>
                <dt className="text-charcoal-muted">Artikel</dt>
                <dd>{count}</dd>
              </dl>
              {s.cutoffNote && <p className="mt-2 text-xs text-charcoal-muted">{s.cutoffNote}</p>}
            </>
          );
          return (
            <li key={s.id}>
              {isAdmin(p) ? (
                <Link href={`/lieferanten/${s.id}`} className="card block hover:border-brand-600">
                  {body}
                </Link>
              ) : (
                <div className="card">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
