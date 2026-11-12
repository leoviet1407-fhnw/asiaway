import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  EMPLOYMENT_LABEL,
  formatTime,
  isLunch,
  stationsOf,
  weekDates,
  weekdayShort,
  type RosterPerson,
  type Shift,
} from '../../domain/roster';
import { LOGO_PNG_BASE64 } from './logo-data';

/**
 * The weekly plan as PDF, in the layout of the paper plan the restaurants know:
 * page 1 the station plan (who stands where, Lunch/Dinner per day), page 2 the
 * plan by person with contract. Both pages are drawn from the same shifts.
 */
const W = 841.89;
const H = 595.28;
const M = 28;
const NAVY = rgb(0.035, 0.078, 0.114);
const RED = rgb(0xac / 255, 0x20 / 255, 0x25 / 255);
const GREY = rgb(0.9, 0.9, 0.9);
const LINE = rgb(1, 1, 1);

const hex = (c: string) => rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);

const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const dmy = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

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

export interface RosterPdfInput {
  siteId: string;
  siteName: string;
  weekStart: string;
  people: readonly RosterPerson[];
  shifts: readonly Shift[];
  generatedAt: Date;
}

export async function renderRosterPdf(input: RosterPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Schichteinteilung ${input.siteName} ${input.weekStart}`);
  pdf.setAuthor('AsiaWay');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));
  const dates = weekDates(input.weekStart);
  const names = new Map(input.people.map((p) => [p.userId, p.name]));
  const stations = stationsOf(input.siteId);
  const colorOf = (station: string) => stations.find((s) => s.name === station);

  const pages: PDFPage[] = [];
  const range = `${dmy(dates[0]!)} - ${dmy(dates[6]!)}`;

  const text = (page: PDFPage, value: string, x: number, y: number, size: number, font = regular, color = NAVY) =>
    page.drawText(safe(font, value), { x, y, size, font, color });
  const centered = (page: PDFPage, value: string, cx: number, y: number, size: number, font = regular, color = NAVY) => {
    const v = safe(font, value);
    page.drawText(v, { x: cx - font.widthOfTextAtSize(v, size) / 2, y, size, font, color });
  };
  const box = (page: PDFPage, x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>) =>
    page.drawRectangle({ x, y, width: w, height: h, color, borderColor: LINE, borderWidth: 0.8 });

  const newPage = (title: string) => {
    const page = pdf.addPage([W, H]);
    pages.push(page);
    text(page, title, M, H - M - 8, 15, bold, RED);
    text(page, range, M, H - M - 22, 8.5, regular, NAVY);
    const lh = 24;
    const lw = (lh * logo.width) / logo.height;
    page.drawImage(logo, { x: W - M - lw, y: H - M - lh + 2, width: lw, height: lh });
    return page;
  };

  const labelW = 150;
  const colW = (W - 2 * M - labelW) / 14;
  const top = H - M - 36;
  const bottom = 40;

  const dayHeader = (page: PDFPage, firstLabel: string, secondLabel?: string): number => {
    let y = top;
    box(page, M, y - 24, labelW, 24, hex('#dfe5da'));
    text(page, firstLabel, M + 4, y - 15, 8, bold);
    if (secondLabel) text(page, secondLabel, M + 80, y - 15, 8, bold);
    dates.forEach((d, i) => {
      const x = M + labelW + i * 2 * colW;
      box(page, x, y - 14, 2 * colW, 14, hex('#dfe5da'));
      centered(page, `${DAY_NAMES[i]} ${dmy(d).slice(0, 5)}`, x + colW, y - 10, 6.6, bold);
      box(page, x, y - 24, colW, 10, hex('#e9eee5'));
      box(page, x + colW, y - 24, colW, 10, hex('#e9eee5'));
      centered(page, 'Lunch', x + colW / 2, y - 21.5, 5.8);
      centered(page, 'Dinner', x + colW * 1.5, y - 21.5, 5.8);
    });
    y -= 24;
    return y;
  };

  // ---- Page 1: station plan ----------------------------------------------------------
  {
    let page = newPage('ASIAWAY - Schichteinteilung · Service');
    let y = dayHeader(page, 'STATIONSEINTEILUNG');
    const ensure = (need: number) => {
      if (y - need < bottom) {
        page = newPage('ASIAWAY - Schichteinteilung · Service (Fortsetzung)');
        y = dayHeader(page, 'STATIONSEINTEILUNG');
      }
    };
    for (const station of stations) {
      const inStation = input.shifts.filter((s) => s.station === station.name);
      if (inStation.length === 0) continue;
      ensure(14 + 22);
      box(page, M, y - 14, W - 2 * M, 14, hex('#f3f3f0'));
      text(page, station.title, M + 4, y - 10, 7.5, bold);
      y -= 14;
      const labels = [...new Set(inStation.map((s) => s.roleLabel ?? 'Schicht'))].sort((a, b) => {
        const first = (l: string) => Math.min(...inStation.filter((s) => (s.roleLabel ?? 'Schicht') === l).map((s) => s.startMin));
        return first(a) - first(b);
      });
      for (const label of labels) {
        const rowShifts = inStation.filter((s) => (s.roleLabel ?? 'Schicht') === label);
        const cell = (d: string, lunch: boolean) => rowShifts.filter((s) => s.date === d && isLunch(s.startMin) === lunch).sort((a, b) => a.startMin - b.startMin);
        const most = Math.max(1, ...dates.flatMap((d) => [cell(d, true).length, cell(d, false).length]));
        const rowH = Math.max(20, most * 15 + 5);
        ensure(rowH);
        box(page, M, y - rowH, labelW, rowH, hex(station.color));
        const first = Math.min(...rowShifts.map((s) => s.startMin));
        text(page, `${formatTime(first)}`, M + 4, y - rowH / 2 - 2, 6.5, bold, station.textColor ? hex(station.textColor) : NAVY);
        text(page, label, M + 30, y - rowH / 2 - 2, 7, regular, station.textColor ? hex(station.textColor) : NAVY);
        dates.forEach((d, i) => {
          for (const lunch of [true, false]) {
            const x = M + labelW + i * 2 * colW + (lunch ? 0 : colW);
            const list = cell(d, lunch);
            box(page, x, y - rowH, colW, rowH, list.length ? hex(station.color) : GREY);
            list.forEach((s, k) => {
              const name = s.userId ? names.get(s.userId) ?? '?' : 'offen';
              const baseY = y - 8 - k * 15;
              const color = station.textColor ? hex(station.textColor) : NAVY;
              centered(page, name, x + colW / 2, baseY, 6.6, bold, s.userId ? color : RED);
              centered(page, `${formatTime(s.startMin)}-${formatTime(s.endMin)}`, x + colW / 2, baseY - 7, 5.2, regular, color);
            });
          }
        });
        y -= rowH;
      }
    }
    if (input.shifts.length === 0) text(page, 'Für diese Woche sind noch keine Schichten geplant.', M, y - 20, 9);
  }

  // ---- Page 2: plan by person ------------------------------------------------------------
  {
    let page = newPage('ASIAWAY - Arbeitsplan nach Uhrzeit · Service');
    const headerFor = (p: PDFPage) => {
      let y = top;
      box(p, M, y - 24, 75, 24, hex('#dfe5da'));
      text(p, 'Mitarbeiter', M + 4, y - 15, 8, bold);
      box(p, M + 75, y - 24, labelW - 75, 24, hex('#dfe5da'));
      text(p, 'Vertrag', M + 79, y - 15, 8, bold);
      dates.forEach((d, i) => {
        const x = M + labelW + i * 2 * colW;
        box(p, x, y - 14, 2 * colW, 14, hex('#dfe5da'));
        centered(p, `${weekdayShort(d)} · ${dmy(d).slice(0, 5)}`, x + colW, y - 10, 6.6, bold);
        box(p, x, y - 24, colW, 10, hex('#e9eee5'));
        box(p, x + colW, y - 24, colW, 10, hex('#e9eee5'));
        centered(p, 'Lunch', x + colW / 2, y - 21.5, 5.8);
        centered(p, 'Dinner', x + colW * 1.5, y - 21.5, 5.8);
      });
      return y - 24;
    };
    let y = headerFor(page);
    for (const person of input.people) {
      const mine = input.shifts.filter((s) => s.userId === person.userId);
      const cell = (d: string, lunch: boolean) => mine.filter((s) => s.date === d && isLunch(s.startMin) === lunch).sort((a, b) => a.startMin - b.startMin);
      const most = Math.max(1, ...dates.flatMap((d) => [cell(d, true).length, cell(d, false).length]));
      const rowH = Math.max(20, most * 8.5 + 7);
      if (y - rowH < bottom) {
        page = newPage('ASIAWAY - Arbeitsplan nach Uhrzeit · Service (Fortsetzung)');
        y = headerFor(page);
      }
      box(page, M, y - rowH, 75, rowH, hex('#f3f3f0'));
      text(page, person.name, M + 4, y - rowH / 2 - 2.5, 8, bold);
      box(page, M + 75, y - rowH, labelW - 75, rowH, hex('#f3f3f0'));
      const contract = person.employmentType === 'FULL_TIME' || person.employmentType === 'PART_TIME' ? `${person.pensumPercent} %` : EMPLOYMENT_LABEL[person.employmentType];
      text(page, contract, M + 79, y - rowH / 2 - 2.5, 7.5);
      dates.forEach((d, i) => {
        for (const lunch of [true, false]) {
          const x = M + labelW + i * 2 * colW + (lunch ? 0 : colW);
          const list = cell(d, lunch);
          if (list.length === 0) {
            box(page, x, y - rowH, colW, rowH, GREY);
            centered(page, '-', x + colW / 2, y - rowH / 2 - 2, 7, regular, rgb(0.6, 0.6, 0.6));
          }
          // Each shift is its own band in the colour of its station.
          list.forEach((s, k) => {
            const station = colorOf(s.station);
            const band = rowH / list.length;
            box(page, x, y - (k + 1) * band, colW, band, hex(station?.color ?? '#e3e1df'));
            centered(page, `${formatTime(s.startMin)} - ${formatTime(s.endMin)}`, x + colW / 2, y - k * band - band / 2 - 2, 5.9, bold, station?.textColor ? hex(station.textColor) : NAVY);
          });
        }
      });
      y -= rowH;
    }
    // Legend
    y -= 14;
    if (y < bottom) {
      page = newPage('ASIAWAY - Arbeitsplan nach Uhrzeit · Service (Fortsetzung)');
      y = top - 10;
    }
    let lx = M;
    text(page, 'LEGENDE', lx, y - 8, 7, bold);
    lx += 46;
    for (const s of stations) {
      const w = Math.min(150, regular.widthOfTextAtSize(safe(regular, s.name), 6.5) + 14);
      box(page, lx, y - 12, w, 12, hex(s.color));
      centered(page, s.name, lx + w / 2, y - 8.5, 6.5, bold, s.textColor ? hex(s.textColor) : NAVY);
      lx += w + 4;
    }
  }

  // Footer on every page
  const stamp = `${input.siteName}, ${new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' }).format(input.generatedAt)}`;
  pages.forEach((p, i) => {
    text(p, 'AsiaWay Staff', M, 20, 6.5, regular, rgb(0.5, 0.5, 0.5));
    centered(p, stamp, W / 2, 20, 6.5, regular, rgb(0.5, 0.5, 0.5));
    const right = `Seite ${i + 1} / ${pages.length}`;
    text(p, right, W - M - regular.widthOfTextAtSize(right, 6.5), 20, 6.5, regular, rgb(0.5, 0.5, 0.5));
  });
  return pdf.save();
}
