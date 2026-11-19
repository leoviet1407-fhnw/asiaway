/** The translated names under a product's original (supplier's) name: Vietnamese · English. */
export function ItemSubtitle({ vi, en, className = '' }: { vi: string | null | undefined; en: string | null | undefined; className?: string }) {
  const parts = [vi, en].filter((x): x is string => Boolean(x && x.trim()));
  if (parts.length === 0) return null;
  return <div className={`text-xs text-charcoal-muted ${className}`}>{parts.join(' · ')}</div>;
}
