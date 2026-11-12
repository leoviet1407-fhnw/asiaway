import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatDay, formatDateTime } from '../../lib/dates';
import { formatQty } from '../../domain/qty';
import type { OrderDocument } from '../mail/order-document';

/**
 * The A4 order sent to the supplier. Uses the PDF standard fonts (no font files
 * to ship); they cover German, and anything they cannot draw becomes "?".
 * Prices are deliberately not printed: suppliers bill from their own list.
 */
const RED = rgb(0xac / 255, 0x20 / 255, 0x25 / 255);
const NAVY = rgb(0x09 / 255, 0x14 / 255, 0x1d / 255);
const CHARCOAL = rgb(0x3e / 255, 0x3a / 255, 0x38 / 255);
const LINE = rgb(0.85, 0.85, 0.85);

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;

function safe(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      // Strip accents we cannot draw (Vietnamese), keep the base letter.
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      try {
        font.encodeText(base);
        out += base;
      } catch {
        out += '?';
      }
    }
  }
  return out;
}

function truncate(font: PDFFont, text: string, size: number, maxWidth: number): string {
  let value = text;
  while (value.length > 1 && font.widthOfTextAtSize(value, size) > maxWidth) value = value.slice(0, -2) + '…';
  return value;
}

export async function renderOrderPdf(doc: OrderDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bestellung ${doc.number}`);
  pdf.setAuthor('AsiaWay');
  pdf.setCreator('AsiaWay Staff');
  pdf.setCreationDate(doc.createdAt);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  const text = (value: string, x: number, size = 10, font = regular, color = CHARCOAL) => {
    page.drawText(safe(font, value), { x, y, size, font, color });
  };

  // Header band
  page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: RED });
  text('AsiaWay', MARGIN, 22, bold, NAVY);
  page.drawText(safe(bold, 'BESTELLUNG'), {
    x: A4[0] - MARGIN - bold.widthOfTextAtSize('BESTELLUNG', 14),
    y,
    size: 14,
    font: bold,
    color: RED,
  });
  y -= 18;
  const numberLabel = `Nr. ${doc.number}`;
  page.drawText(numberLabel, { x: A4[0] - MARGIN - regular.widthOfTextAtSize(numberLabel, 10), y, size: 10, font: regular, color: CHARCOAL });
  y -= 30;

  // Two address columns
  const colB = A4[0] / 2 + 10;
  const top = y;
  text('An', MARGIN, 8, bold, CHARCOAL);
  y -= 13;
  text(doc.supplier.name, MARGIN, 11, bold, NAVY);
  y -= 14;
  if (doc.supplier.customerNumber) text(`Unsere Kundennummer: ${doc.supplier.customerNumber}`, MARGIN);

  y = top;
  text('Lieferadresse', colB, 8, bold);
  y -= 13;
  text(`AsiaWay ${doc.location.name}`, colB, 11, bold, NAVY);
  for (const part of doc.location.address.split(',').map((s) => s.trim())) {
    y -= 14;
    text(part, colB);
  }
  if (doc.location.deliveryNote) {
    y -= 14;
    text(truncate(regular, safe(regular, doc.location.deliveryNote), 9, A4[0] / 2 - MARGIN - 10), colB, 9);
  }
  y -= 28;

  const meta: [string, string][] = [
    ['Bestelldatum', formatDateTime(doc.createdAt)],
    ['Gewünschte Lieferung', doc.deliveryDate ? formatDay(doc.deliveryDate) : 'nächster Liefertag'],
    ['Bestellt von', `${doc.orderedBy.name} (${doc.orderedBy.email})`],
  ];
  for (const [label, value] of meta) {
    text(label, MARGIN, 10, bold);
    text(value, MARGIN + 140, 10);
    y -= 15;
  }
  y -= 12;

  // Table
  const cols = { pos: MARGIN, sku: MARGIN + 30, name: MARGIN + 110, qty: A4[0] - MARGIN - 150, unit: A4[0] - MARGIN - 95 };
  const header = () => {
    page.drawRectangle({ x: MARGIN - 4, y: y - 5, width: A4[0] - 2 * MARGIN + 8, height: 18, color: NAVY });
    const white = rgb(1, 1, 1);
    text('Pos', cols.pos, 9, bold, white);
    text('Art.-Nr.', cols.sku, 9, bold, white);
    text('Artikel', cols.name, 9, bold, white);
    text('Menge', cols.qty, 9, bold, white);
    text('Einheit', cols.unit, 9, bold, white);
    y -= 22;
  };
  header();

  doc.lines.forEach((line, i) => {
    const rowHeight = line.note ? 28 : 18;
    if (y - rowHeight < MARGIN + 60) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
      text(`Bestellung ${doc.number} (Fortsetzung)`, MARGIN, 10, bold, NAVY);
      y -= 24;
      header();
    }
    text(String(i + 1), cols.pos);
    text(truncate(regular, safe(regular, line.supplierSku ?? '–'), 10, cols.name - cols.sku - 6), cols.sku);
    text(truncate(regular, safe(regular, line.name), 10, cols.qty - cols.name - 8), cols.name);
    const qty = formatQty(line.qty);
    page.drawText(qty, { x: cols.unit - 12 - bold.widthOfTextAtSize(qty, 10), y, size: 10, font: bold, color: NAVY });
    text(truncate(regular, safe(regular, line.orderUnit), 10, A4[0] - MARGIN - cols.unit), cols.unit);
    if (line.note) {
      y -= 12;
      text(truncate(regular, safe(regular, `Hinweis: ${line.note}`), 8, cols.qty - cols.name), cols.name, 8);
    }
    y -= 8;
    page.drawLine({ start: { x: MARGIN - 4, y }, end: { x: A4[0] - MARGIN + 4, y }, thickness: 0.5, color: LINE });
    y -= 12;
  });

  y -= 6;
  text(`${doc.lines.length} Positionen`, MARGIN, 9);
  y -= 20;
  if (doc.note) {
    text('Bemerkung', MARGIN, 10, bold);
    y -= 14;
    for (const chunk of wrap(regular, safe(regular, doc.note), 10, A4[0] - 2 * MARGIN)) {
      text(chunk, MARGIN);
      y -= 13;
    }
    y -= 8;
  }
  text('Bitte bestätigen Sie den Liefertermin per Antwort auf die Bestell-E-Mail. Vielen Dank!', MARGIN, 9);

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const footer = `AsiaWay · Bestellung ${doc.number} · Seite ${i + 1}/${pages.length}`;
    p.drawText(footer, { x: MARGIN, y: 30, size: 8, font: regular, color: CHARCOAL });
  });

  return pdf.save();
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}
