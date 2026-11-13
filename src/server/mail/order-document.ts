import { formatDay, formatDateTime } from '../../lib/dates';
import { formatQty } from '../../domain/qty';

/**
 * Everything the order email and PDF show, assembled once so both say the same.
 * The sheet follows the supplier order the restaurants already use: Abteilung,
 * Gruppe, Menge with its unit, the pack description, article number, name.
 */
export interface OrderDocument {
  readonly number: string;
  readonly createdAt: Date;
  readonly deliveryDate: string | null;
  readonly note: string | null;
  readonly location: {
    readonly name: string;
    readonly address: string;
    readonly deliveryNote: string | null;
    readonly phone: string | null;
    readonly contactEmail: string | null;
  };
  readonly supplier: {
    readonly name: string;
    readonly customerNumber: string | null;
    readonly orderEmail: string;
    readonly ccEmail: string | null;
  };
  readonly orderedBy: { readonly name: string; readonly email: string };
  readonly lines: readonly {
    /** Kitchen, production, cleaning … (the department that uses the goods). */
    readonly department: string | null;
    /** Food, vegetables, frozen … */
    readonly group: string | null;
    readonly supplierSku: string | null;
    readonly name: string;
    readonly qty: number;
    /** What the quantity is counted in: kg, Karton, Stück. */
    readonly quantityUnit: string | null;
    /** The pack: "Karton zu 20l". */
    readonly orderUnit: string;
    readonly note: string | null;
  }[];
}

const WEEKDAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** "Dienstag, 10.11.2026" – the delivery day written out for the supplier. */
export function deliveryDayLabel(isoDate: string | null): string {
  if (!isoDate) return 'nächster Liefertag';
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const name = WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${name}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

/** "20 kg" / "3 Karton" – the number with the unit it is counted in. */
export function quantityLabel(line: { qty: number; quantityUnit: string | null }): string {
  return line.quantityUnit ? `${formatQty(line.qty)} ${line.quantityUnit}` : formatQty(line.qty);
}

/** The restaurant as the supplier knows it: "Restaurant Winterthur, Archplatz 2, 8400 Winterthur". */
export function deliveryAddressLine(doc: OrderDocument): string {
  return `Restaurant ${doc.location.name}, ${doc.location.address}`;
}

export function orderSubject(doc: OrderDocument): string {
  const delivery = doc.deliveryDate ? ` – Lieferung ${formatDay(doc.deliveryDate)}` : '';
  return `Bestellung AsiaWay ${doc.location.name} – ${doc.number}${delivery}`;
}

export function orderEmailText(doc: OrderDocument): string {
  const lines = doc.lines.map((l, i) => {
    const sku = l.supplierSku ? ` [${l.supplierSku}]` : '';
    const pack = l.orderUnit && l.orderUnit !== l.quantityUnit ? ` (${l.orderUnit})` : '';
    const note = l.note ? ` – ${l.note}` : '';
    return `${String(i + 1).padStart(2, ' ')}. ${quantityLabel(l)}  ${l.name}${pack}${sku}${note}`;
  });
  return [
    'Guten Tag',
    '',
    `Wir bestellen gerne folgende Artikel (Bestellung ${doc.number}):`,
    '',
    ...lines,
    '',
    `Lieferadresse: ${deliveryAddressLine(doc)}`,
    ...(doc.location.deliveryNote ? [`Hinweis Anlieferung: ${doc.location.deliveryNote}`] : []),
    `Gewünschte Lieferung: ${deliveryDayLabel(doc.deliveryDate)}`,
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
