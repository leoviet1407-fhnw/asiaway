import Link from 'next/link';
import { ItemSubtitle } from '@/components/ItemSubtitle';
import { formatChf } from '@/domain/qty';

import { requirePrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { STORAGE_AREA_LABEL, STORAGE_AREA_ORDER, canEditItems, listItems } from '@/server/services/catalog-service';
import { getT } from '@/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('Artikel') };
}

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string; ohne?: string }> }) {
  const t = await getT();
  const p = await requirePrincipal();
  const { q = '', ohne } = await searchParams;
  const missingOnly = ohne === 'barcode';
  const editor = canEditItems(p);
  const all = await listItems(await db(), { includeInactive: editor });
  const query = q.trim().toLowerCase();
  const noCode = (i: (typeof all)[number]) => i.active && !i.isFresh && i.offers.some((o) => o.active) && i.barcodes.length === 0;
  const missingCount = all.filter(noCode).length;
  const items = (missingOnly ? all.filter(noCode) : all).filter((i) =>
    query ? [i.nameDe, i.nameVi ?? '', i.nameEn ?? '', i.sku, ...i.barcodes.map((b) => b.code)].some((s) => s.toLowerCase().includes(query)) : true,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">{t('Artikel')}</h1>
          <p className="text-sm text-charcoal-muted">{all.length} {t('Artikel')}{editor ? ` · ${t('Antippen zum Ändern')}` : ''}</p>
        </div>
        {editor && <Link href="/artikel/neu" className="btn-primary shrink-0">{t('+ Neuer Artikel')}</Link>}
      </div>
      {editor && missingCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/artikel" className={`chip px-3 py-1 ${!missingOnly ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{t('Alle')}</Link>
          <Link href="/artikel?ohne=barcode" className={`chip px-3 py-1 ${missingOnly ? 'bg-brand-600 text-white' : 'bg-white text-charcoal ring-1 ring-surface-line'}`}>{t('Ohne Barcode ({n})', { n: missingCount })}</Link>
        </div>
      )}
      {missingOnly && <p className="rounded-btn bg-navy-50 p-3 text-sm text-navy">{t('Artikel antippen, dann „📷 Barcode scannen“ und speichern. Danach geht es mit „Nächster Artikel ohne Barcode“ weiter. Frischware braucht keinen Barcode.')}</p>}
      <form>
        {missingOnly && <input type="hidden" name="ohne" value="barcode" />}
        <input type="search" name="q" defaultValue={q} placeholder={t('Name, Art.-Nr. oder Barcode …')} className="w-full" />
      </form>
      {STORAGE_AREA_ORDER.map((area) => {
        const group = items.filter((i) => i.storageArea === area);
        if (group.length === 0) return null;
        return (
          <section key={area}>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-charcoal-muted">{t(STORAGE_AREA_LABEL[area])}</h2>
            <ul className="divide-y divide-surface-line overflow-hidden rounded-btn border border-surface-line bg-white">
              {group.map((i) => {
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className={`font-medium text-navy ${i.active ? '' : 'line-through opacity-60'}`}>
                        {i.nameDe}
                        {i.isKeyItem && <span className="chip ml-1 bg-navy-50 text-[10px] text-navy">{t('Key')}</span>}
                        {i.isFresh && <span className="chip ml-1 bg-ok-50 text-[10px] text-ok-500">{t('frisch')}</span>}
                      </div>
                      <ItemSubtitle vi={i.nameVi} en={i.nameEn} />
                      <div className="text-xs text-charcoal-muted">
                        {i.sku} · {i.barcodes.length > 0 ? i.barcodes.map((b) => b.code).join(', ') : t('kein Barcode')}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      {i.offers.filter((o) => o.active).map((o) => (
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
                    {editor ? (
                      <Link href={`/artikel/${i.id}${missingOnly ? '?aufgabe=barcode' : ''}`} className="flex gap-3 px-3 py-2 hover:bg-surface-sunken">
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
