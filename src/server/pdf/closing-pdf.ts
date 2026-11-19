import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { CLOSING_STATUS_LABEL, DIFFERENCE_LABEL, differenceTone } from '../../domain/closing';
import type { ClosingView } from '../services/closing-service';
import { LOGO_PNG_BASE64 } from './logo-data';

/** The daily closing on one A5 page (portrait), like the paper form: print it, sign it, file it. */
const W = 419.53;
const H = 595.28;
const M = 30;
const COL2 = M + (W - 2 * M) * 0.36;
const COL3 = M + (W - 2 * M) * 0.64;
const SIGN_W = (W - 2 * M) / 2 - 12;
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
  const lw = (24 * logo.width) / logo.height;
  page.drawImage(logo, { x: W - M - lw, y: y - 20, width: lw, height: 24 });
  text('Tagesabschluss', M, y - 10, 16, bold, RED);
  text(`${c.locationName} · ${c.station}`, M, y - 26, 10);
  y -= 46;
  rule(y);
  y -= 18;
  text('Geschäftstag', M, y, 8, regular, GREY);
  text(dmy(c.businessDate), M, y - 13, 11, bold);
  text('Status', COL2, y, 8, regular, GREY);
  text(CLOSING_STATUS_LABEL[c.status], COL2, y - 13, 11, bold);
  text('Abgeschlossen von', COL3, y, 8, regular, GREY);
  text(c.closedByName ?? '-', COL3, y - 13, 10, bold);
  text(stamp(c.createdAt), COL3, y - 25, 7.5, regular, GREY);
  y -= 40;
  rule(y);
  y -= 20;

  const row = (label: string, value: number, opts: { strong?: boolean; sign?: string } = {}) => {
    const font = opts.strong ? bold : regular;
    text(label, M, y, opts.strong ? 10.5 : 9.5, font);
    right(`CHF ${chf(value)}`, W - M, y, opts.strong ? 10.5 : 9.5, font);
    y -= 6;
    rule(y);
    y -= 15;
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
  y -= 2;
  page.drawRectangle({ x: M, y: y - 22, width: W - 2 * M, height: 30, color: rgb(0.97, 0.93, 0.93), borderColor: RED, borderWidth: 1 });
  text('BANK EINZAHLEN', M + 10, y - 10, 11, bold, RED);
  right(`CHF ${chf(r.bankDepositCents)}`, W - M - 10, y - 10, 13, bold, RED);
  y -= 46;

  if (c.note) {
    text('Notiz', M, y, 8, regular, GREY);
    y -= 12;
    let line = '';
    let lines = 0;
    for (const word of safe(regular, c.note).split(/\s+/)) {
      if (regular.widthOfTextAtSize(`${line} ${word}`, 9) > W - 2 * M) {
        if (lines < 4) text(line, M, y, 9);
        lines += 1;
        y -= 11;
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line && lines < 5) text(line, M, y, 9);
    y -= 18;
  }

  // Signatures (always above the footer, even with a long note)
  const sy = Math.max(Math.min(y, 120), 95);
  page.drawLine({ start: { x: M, y: sy - 32 }, end: { x: M + SIGN_W, y: sy - 32 }, thickness: 0.8, color: NAVY });
  text('Kassiert / abgeschlossen (Unterschrift)', M, sy - 43, 7, regular, GREY);
  text(c.closedByName ?? '', M, sy - 26, 8.5);
  page.drawLine({ start: { x: W - M - SIGN_W, y: sy - 32 }, end: { x: W - M, y: sy - 32 }, thickness: 0.8, color: NAVY });
  text('Kontrolliert / freigegeben (Unterschrift)', W - M - SIGN_W, sy - 43, 7, regular, GREY);
  if (c.status === 'APPROVED') text(`${c.approvedByName ?? '-'} · ${c.approvedAt ? stamp(c.approvedAt) : ''}`, W - M - SIGN_W, sy - 26, 8.5);

  text(`asiaway - Gastro App · gedruckt ${stamp(generatedAt)}`, M, 22, 7, regular, GREY);
  return pdf.save();
}
