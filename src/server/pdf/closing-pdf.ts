import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { CLOSING_STATUS_LABEL, DIFFERENCE_LABEL, differenceTone } from '../../domain/closing';
import type { ClosingView } from '../services/closing-service';
import { LOGO_PNG_BASE64 } from './logo-data';

/** The daily closing on one A4 page, like the paper form: print it, sign it, file it. */
const W = 595.28;
const H = 841.89;
const M = 44;
const NAVY = rgb(0.035, 0.078, 0.114);
const RED = rgb(0xac / 255, 0x20 / 255, 0x25 / 255);
const GREY = rgb(0.55, 0.55, 0.55);
const LINE = rgb(0.82, 0.82, 0.82);

const dmy = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const chf = (c: number) => (c / 100).toFixed(2);
const stamp = (d: Date) => new Intl.DateTimeFormat('de-CH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Zurich' }).format(d);

function safe(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
    }
  }
  return out;
}

export async function renderClosingPdf(c: ClosingView, generatedAt = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Tagesabschluss ${c.locationName} ${c.businessDate}`);
  pdf.setAuthor('AsiaWay');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));
  const page = pdf.addPage([W, H]);
  const text = (value: string, x: number, y: number, size = 10, font = regular, color = NAVY) => page.drawText(safe(font, value), { x, y, size, font, color });
  const right = (value: string, xr: number, y: number, size = 10, font = regular, color = NAVY) => {
    const v = safe(font, value);
    page.drawText(v, { x: xr - font.widthOfTextAtSize(v, size), y, size, font, color });
  };
  const rule = (y: number, color = LINE) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color });

  let y = H - M;
  const lw = (30 * logo.width) / logo.height;
  page.drawImage(logo, { x: W - M - lw, y: y - 26, width: lw, height: 30 });
  text('Tagesabschluss', M, y - 12, 20, bold, RED);
  text(`${c.locationName} · ${c.station}`, M, y - 32, 11);
  y -= 62;
  rule(y);
  y -= 22;
  text('Geschäftstag', M, y, 9, regular, GREY);
  text(dmy(c.businessDate), M, y - 14, 13, bold);
  text('Status', 230, y, 9, regular, GREY);
  text(CLOSING_STATUS_LABEL[c.status], 230, y - 14, 13, bold);
  text('Abgeschlossen von', 360, y, 9, regular, GREY);
  text(c.closedByName ?? '-', 360, y - 14, 11, bold);
  text(stamp(c.createdAt), 360, y - 27, 8.5, regular, GREY);
  y -= 50;
  rule(y);
  y -= 26;

  const row = (label: string, value: number, opts: { strong?: boolean; sign?: string } = {}) => {
    const font = opts.strong ? bold : regular;
    text(label, M, y, opts.strong ? 11.5 : 10.5, font);
    right(`CHF ${chf(value)}`, W - M, y, opts.strong ? 11.5 : 10.5, font);
    y -= 7;
    rule(y);
    y -= 17;
  };
  const r = c.result;
  row('Cashbestand (Kassa)', c.cashCountedCents);
  row('- Anfangsbestand', c.startFloatCents);
  row('= Barumsatz', r.cashSalesCents, { strong: true });
  row('+ EFT', c.eftCents);
  row('+ Mobile Payment', c.mobileCents);
  row('TOTAL (IST)', r.totalActualCents, { strong: true });
  row('Kassen-Brutto (SOLL, Hypersoft)', c.posGrossCents);
  row(`Differenz - ${DIFFERENCE_LABEL[differenceTone(r.differenceCents)]}`, r.differenceCents, { strong: true });

  // The amount that goes to the bank, highlighted
  y -= 4;
  page.drawRectangle({ x: M, y: y - 26, width: W - 2 * M, height: 34, color: rgb(0.97, 0.93, 0.93), borderColor: RED, borderWidth: 1 });
  text('BANK EINZAHLEN', M + 12, y - 12, 12, bold, RED);
  right(`CHF ${chf(r.bankDepositCents)}`, W - M - 12, y - 12, 14, bold, RED);
  y -= 58;

  if (c.note) {
    text('Notiz', M, y, 9, regular, GREY);
    y -= 14;
    let line = '';
    for (const word of safe(regular, c.note).split(/\s+/)) {
      if (regular.widthOfTextAtSize(`${line} ${word}`, 10) > W - 2 * M) {
        text(line, M, y);
        y -= 13;
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) text(line, M, y);
    y -= 26;
  }

  // Signatures
  const sy = Math.min(y, 190);
  page.drawLine({ start: { x: M, y: sy - 40 }, end: { x: M + 200, y: sy - 40 }, thickness: 0.8, color: NAVY });
  text('Kassiert / abgeschlossen (Unterschrift)', M, sy - 53, 8.5, regular, GREY);
  text(c.closedByName ?? '', M, sy - 33, 9);
  page.drawLine({ start: { x: W - M - 200, y: sy - 40 }, end: { x: W - M, y: sy - 40 }, thickness: 0.8, color: NAVY });
  text('Kontrolliert / freigegeben (Unterschrift)', W - M - 200, sy - 53, 8.5, regular, GREY);
  if (c.status === 'APPROVED') text(`${c.approvedByName ?? '-'} · ${c.approvedAt ? stamp(c.approvedAt) : ''}`, W - M - 200, sy - 33, 9);

  text(`asiaway - Gastro App · gedruckt ${stamp(generatedAt)}`, M, 30, 8, regular, GREY);
  return pdf.save();
}
