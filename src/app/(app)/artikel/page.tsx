import Link from 'next/link';
import { formatChf } from '@/domain/qty';
import { isAdmin } from '@/domain/roles';
import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { STORAGE_AREA_LABEL, STORAGE_AREA_ORDER, listItems } from '@/server/services/catalog-service';

export const metadata = { title: 'Artikel' };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const p = await requirePrincipal();
  const { q = '' } = await searchParams;
  const all = await listItems(await db(), { includeInactive: isAdmin(p) });
  const query = q.trim().toLowerCase();
  const items = query
    ? all.filter((i) => [i.nameDe, i.nameVi ?? '', i.sku, ...i.barcodes.map((b) => b.code)].some((s) => s.toLowerCase().includes(query)))
    : all;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl">Artikel</h1>
        <p className="text-sm text-charcoal-muted">{all.length} Artikel · Musterdaten bis die echten Listen importiert sind</p>
      </div>
      <form>
        <input type="search" name="q" defaultValue={q} placeholder="Name, Art.-Nr. oder Barcode …" className="w-full" />
      </form>
      {STORAGE_AREA_ORDER.map((area) => {
        const group = items.filter((i) => i.storageArea === area);
        if (group.length === 0) return null;
        return (
          <section key={area}>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-charcoal-muted">{STORAGE_AREA_LABEL[area]}</h2>
            <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
              {group.map((i) => {
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className={`font-medium text-navy ${i.active ? '' : 'line-through opacity-60'}`}>
                        {i.nameDe}
                        {i.isKeyItem && <span className="chip ml-1 bg-navy-50 text-[10px] text-navy">Key</span>}
                        {i.isFresh && <span className="chip ml-1 bg-ok-50 text-[10px] text-ok-500">frisch</span>}
                      </div>
                      {i.nameVi && <div className="text-xs text-charcoal-muted">{i.nameVi}</div>}
                      <div className="text-xs text-charcoal-muted">
                        {i.sku} · {i.barcodes.length > 0 ? i.barcodes.map((b) => b.code).join(', ') : 'kein Barcode'}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      {i.offers.map((o) => (
                        <div key={o.supplierItemId}>
                          <div className="font-semibold text-navy">{formatChf(o.priceCents)}</div>
                          <div className="text-charcoal-muted">{o.orderUnit}</div>
                          <div className="text-charcoal-muted">{o.supplierName}</div>
                        </div>
                      ))}
                    </div>
                  </>
                );
                return (
                  <li key={i.id}>
                    {isAdmin(p) ? (
                      <Link href={`/artikel/${i.id}`} className="flex gap-3 px-3 py-2 hover:bg-surface-sunken">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-3 py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
