import { formatDay, formatDateTime } from '../../lib/dates';
import { formatAmount } from '../../domain/qty';

/**
 * Everything the order email and PDF show, assembled once so both say the same.
 */
export interface OrderDocument {
  readonly number: string;
  readonly createdAt: Date;
  readonly deliveryDate: string | null;
  readonly note: string | null;
  readonly location: { readonly name: string; readonly address: string; readonly deliveryNote: string | null };
  readonly supplier: { readonly name: string; readonly customerNumber: string | null };
  readonly orderedBy: { readonly name: string; readonly email: string };
  readonly lines: readonly {
    readonly supplierSku: string | null;
    readonly name: string;
    readonly qty: number;
    readonly orderUnit: string;
    readonly note: string | null;
  }[];
}

export function orderSubject(doc: OrderDocument): string {
  const delivery = doc.deliveryDate ? ` – Lieferung ${formatDay(doc.deliveryDate)}` : '';
  return `Bestellung AsiaWay ${doc.location.name} – ${doc.number}${delivery}`;
}

export function orderEmailText(doc: OrderDocument): string {
  const lines = doc.lines.map((l, i) => {
    const sku = l.supplierSku ? ` [${l.supplierSku}]` : '';
    const note = l.note ? ` – ${l.note}` : '';
    const amount = formatAmount(l.qty, l.orderUnit);
    return `${String(i + 1).padStart(2, ' ')}. ${amount}  ${l.name}${sku}${note}`;
  });
  return [
    'Guten Tag',
    '',
    `Wir bestellen gerne folgende Artikel (Bestellung ${doc.number}):`,
    '',
    ...lines,
    '',
    `Lieferadresse: AsiaWay ${doc.location.name}, ${doc.location.address}`,
    ...(doc.location.deliveryNote ? [`Hinweis Anlieferung: ${doc.location.deliveryNote}`] : []),
    `Gewünschte Lieferung: ${doc.deliveryDate ? formatDay(doc.deliveryDate) : 'nächster Liefertag'}`,
    ...(doc.supplier.customerNumber ? [`Kundennummer: ${doc.supplier.customerNumber}`] : []),
    ...(doc.note ? ['', `Bemerkung: ${doc.note}`] : []),
    '',
    'Die Bestellung liegt auch als PDF bei. Bitte bestätigen Sie den Liefertermin kurz per Antwort auf diese E-Mail.',
    '',
    'Freundliche Grüsse',
    `${doc.orderedBy.name}`,
    `AsiaWay – ${formatDateTime(doc.createdAt)}`,
  ].join('\n');
}

export function orderPdfFilename(doc: OrderDocument): string {
  return `AsiaWay-Bestellung-${doc.number}.pdf`;
}
