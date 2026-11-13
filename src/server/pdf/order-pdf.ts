import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatDateTime } from '../../lib/dates';
import { deliveryAddressLine, deliveryDayLabel, quantityLabel, type OrderDocument } from '../mail/order-document';
import { LOGO_PNG_BASE64 } from './logo-data';

/**
 * The order sheet the supplier receives, in the layout the restaurants already
 * use with Prodega: landscape, "Bestellung für …", To/Cc, customer number and
 * delivery address on the right, a beige date bar, then Abteilung · Gruppe ·
 * Menge · Einheit · Art.Nr. · Art. Bezeichnung. Prices are deliberately not
 * printed: suppliers bill from their own list.
 */
const W = 841.89;
const H = 595.28;
const M = 30;

const INK = rgb(0, 0, 0);
const NAVY = rgb(0x1f / 255, 0x38 / 255, 0x64 / 255);
const RED = rgb(0xac / 255, 0x20 / 255, 0x25 / 255);
const BEIGE = rgb(0xdd / 255, 0xd9 / 255, 0xc4 / 255);
const HEADER_BLUE = rgb(0xc5 / 255, 0xd9 / 255, 0xf1 / 255);
const GREEN = rgb(0xd8 / 255, 0xe4 / 255, 0xbc / 255);
const RULE = rgb(0.82, 0.82, 0.82);
const GREY = rgb(0.45, 0.45, 0.45);

/** The PDF standard fonts draw German; anything else (Vietnamese accents) falls back to the base letter. */
function safe(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
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

function fit(font: PDFFont, text: string, size: number, maxWidth: number): string {
  let value = safe(font, text);
  while (value.length > 1 && font.widthOfTextAtSize(value, size) > maxWidth) value = value.slice(0, -2) + '…';
  return value;
}

/** "Prodega" → "P R O D E G A", as on the supplier's own sheet. */
const spaced = (name: string) => [...name.toUpperCase()].join(' ').replace(/ {2,}/g, '   ');

export async function renderOrderPdf(doc: OrderDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bestellung ${doc.number}`);
  pdf.setAuthor('AsiaWay');
  pdf.setCreator('AsiaWay Staff');
  pdf.setCreationDate(doc.createdAt);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));

  const cols = [
    { key: 'dept', title: 'Abteilung', w: 92 },
    { key: 'group', title: 'Gruppe', w: 84 },
    { key: 'qty', title: 'Menge', w: 84 },
    { key: 'unit', title: 'Einheit', w: 150 },
    { key: 'sku', title: 'Art.Nr.', w: 78 },
    { key: 'name', title: 'Art. Bezeichnung', w: W - 2 * M - (92 + 84 + 84 + 150 + 78) },
  ] as const;
  const x0 = M;
  const colX: number[] = [];
  cols.forEach((c, i) => colX.push(i === 0 ? x0 : colX[i - 1]! + cols[i - 1]!.w));
  const tableW = W - 2 * M;

  const pages: PDFPage[] = [];
  const draw = (page: PDFPage, value: string, x: number, y: number, size: number, font = regular, color = INK) =>
    page.drawText(safe(font, value), { x, y, size, font, color });
  const right = (page: PDFPage, value: string, y: number, size: number, font = regular, color = INK) => {
    const v = safe(font, value);
    page.drawText(v, { x: W - M - font.widthOfTextAtSize(v, size), y, size, font, color });
  };

  const tableHeader = (page: PDFPage, y: number): number => {
    page.drawRectangle({ x: x0, y: y - 22, width: tableW, height: 22, color: HEADER_BLUE });
    cols.forEach((c, i) => draw(page, c.title, colX[i]! + 4, y - 15, 11, regular, c.key === 'qty' ? RED : INK));
    return y - 22;
  };

  let page = pdf.addPage([W, H]);
  pages.push(page);
  let y = H - M;

  // Title and header block
  draw(page, `Bestellung für ${spaced(doc.supplier.name)}`, M, y - 18, 22);
  const lh = 18;
  const lw = (lh * logo.width) / logo.height;
  page.drawImage(logo, { x: W - M - lw, y: y - 16, width: lw, height: lh });

  const to = `To: ${doc.supplier.orderEmail}`;
  const cc = doc.supplier.ccEmail ? `Cc: ${doc.supplier.ccEmail}` : null;
  draw(page, to, M, y - 46, 9);
  if (cc) draw(page, cc, M, y - 59, 9);

  let ry = y - 40;
  if (doc.supplier.customerNumber) {
    right(page, `Kundennummer ${doc.supplier.customerNumber}`, ry, 10);
    ry -= 14;
  }
  right(page, deliveryAddressLine(doc), ry, 9, regular, RED);
  ry -= 12;
  if (doc.location.phone) {
    right(page, doc.location.phone, ry, 9);
    ry -= 12;
  }
  if (doc.location.contactEmail) {
    right(page, doc.location.contactEmail, ry, 9);
    ry -= 12;
  }
  if (doc.location.deliveryNote) right(page, doc.location.deliveryNote, ry, 8, regular, GREY);

  // Date bar
  y -= 92;
  page.drawRectangle({ x: x0, y: y - 38, width: tableW, height: 38, color: BEIGE });
  draw(page, 'Bestelldatum', x0 + 4, y - 14, 12);
  draw(page, formatDateTime(doc.createdAt).slice(0, 10), x0 + 4 + 250, y - 14, 12);
  draw(page, 'Lieferdatum', x0 + 4, y - 31, 12, regular, RED);
  draw(page, deliveryDayLabel(doc.deliveryDate), x0 + 4 + 250, y - 31, 12, regular, RED);
  y -= 46;

  y = tableHeader(page, y);

  doc.lines.forEach((line, i) => {
    const rowH = line.note ? 28 : 18;
    if (y - rowH < 50) {
      page = pdf.addPage([W, H]);
      pages.push(page);
      draw(page, `Bestellung ${doc.number} (Fortsetzung)`, M, H - M - 10, 12, bold, RED);
      y = tableHeader(page, H - M - 22);
    }
    const textY = y - 12.5;
    const cell = (i2: number) => colX[i2]! + 4;
    draw(page, fit(regular, (line.department ?? '').toUpperCase(), 10, cols[0].w - 8), cell(0), textY, 10, regular, NAVY);
    draw(page, fit(regular, (line.group ?? '').toUpperCase(), 10, cols[1].w - 8), cell(1), textY, 10);
    // Menge: red on green, as on the supplier's sheet
    page.drawRectangle({ x: colX[2]!, y: y - rowH + 1, width: cols[2].w, height: rowH - 1, color: GREEN });
    const qty = fit(regular, quantityLabel(line), 11, cols[2].w - 8);
    draw(page, qty, colX[2]! + (cols[2].w - regular.widthOfTextAtSize(qty, 11)) / 2, textY, 11, regular, RED);
    draw(page, fit(regular, line.orderUnit, 10, cols[3].w - 8), cell(3), textY, 10);
    draw(page, fit(regular, line.supplierSku ?? '', 10, cols[4].w - 8), cell(4), textY, 10);
    draw(page, fit(regular, line.name, 10, cols[5].w - 8), cell(5), textY, 10);
    if (line.note) draw(page, fit(regular, `Hinweis: ${line.note}`, 8, cols[5].w - 8), cell(5), textY - 11, 8, regular, GREY);
    y -= rowH;
    page.drawLine({ start: { x: x0, y }, end: { x: x0 + tableW, y }, thickness: 0.5, color: RULE });
    void i;
  });

  y -= 18;
  if (doc.note) {
    if (y < 80) {
      page = pdf.addPage([W, H]);
      pages.push(page);
      y = H - M - 10;
    }
    draw(page, 'Bemerkung', M, y, 10, bold);
    draw(page, fit(regular, doc.note, 10, tableW), M + 70, y, 10);
    y -= 18;
  }
  draw(page, 'Bitte bestätigen Sie den Liefertermin per Antwort auf die Bestell-E-Mail. Vielen Dank!', M, y, 9, regular, GREY);

  pages.forEach((p, i) => {
    draw(p, `AsiaWay · Bestellung ${doc.number} · bestellt von ${doc.orderedBy.name}`, M, 22, 8, regular, GREY);
    const label = `Seite ${i + 1} von ${pages.length}`;
    p.drawText(label, { x: W - M - regular.widthOfTextAtSize(label, 8), y: 22, size: 8, font: regular, color: GREY });
  });

  return pdf.save();
}
