import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { DINNER_WINDOW, LUNCH_WINDOW } from '../../domain/availability';
import {
  ABSENCE_LABEL,
  EMPLOYMENT_LABEL,
  formatTime,
  isLunch,
  shiftNetMinutes,
  stationsOf,
  weekDates,
  weekdayShort,
  weeklyTargetCorridor,
  type Absence,
  type RosterPerson,
  type Shift,
} from '../../domain/roster';
import { LOGO_PNG_BASE64 } from './logo-data';

/**
 * The weekly plan as PDF (A4 landscape), in the layout of the paper plan the restaurants know,
 * with the extras that make it useful at a glance:
 *   page 1  the station plan: who stands where, Lunch / Dinner per day, how many people per service
 *   page 2  the plan by person: times, holidays, hours against the contract, people and hours per day,
 *           and below it holidays, special days, open shifts and the week's totals
 * A draft carries an "ENTWURF" watermark so nobody takes it for the final plan.
 */
const W = 841.89;
const H = 595.28;
const M = 28;
const NAVY = rgb(0.035, 0.078, 0.114);
const RED = rgb(0xac / 255, 0x20 / 255, 0x25 / 255);
const MUTED = rgb(0.45, 0.45, 0.45);
const FAINT = rgb(0.62, 0.62, 0.62);
const HEAD = rgb(0.875, 0.898, 0.855); // day header
const HEAD2 = rgb(0.914, 0.933, 0.898); // Lunch / Dinner header
const GREY = rgb(0.92, 0.92, 0.91);
const PAPER = rgb(0.965, 0.965, 0.95);
const LINE = rgb(1, 1, 1);
const OK = rgb(0.12, 0.42, 0.23);
const WARN = rgb(0.76, 0.5, 0.05);

const hex = (c: string) => rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);

const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const dm = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.`;
const dmy = (iso: string) => `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const hoursText = (min: number) => `${(Math.round(min / 6) / 10).toFixed(1)} h`;

/** ISO week number (KW). */
function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

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
  /** A draft gets an "ENTWURF" watermark. */
  status?: 'DRAFT' | 'PUBLISHED';
  absences?: readonly Pick<Absence, 'userId' | 'startDate' | 'endDate' | 'type'>[];
  /** Holidays, Silvester, closed days. */
  specialDays?: readonly { date: string; label: string; closed: boolean }[];
}

export async function renderRosterPdf(input: RosterPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Dienstplan ${input.siteName} ${input.weekStart}`);
  pdf.setAuthor('AsiaWay');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, 'base64'));
  const dates = weekDates(input.weekStart);
  const names = new Map(input.people.map((p) => [p.userId, p.name]));
  const stations = stationsOf(input.siteId);
  const stationOf = (name: string) => stations.find((s) => s.name === name);
  const absences = input.absences ?? [];
  const specials = new Map((input.specialDays ?? []).map((s) => [s.date, s]));
  const draft = input.status === 'DRAFT';
  const kw = isoWeek(input.weekStart);
  const range = `${Number(dates[0]!.slice(8))}. ${dates[0]!.slice(5, 7) === dates[6]!.slice(5, 7) ? '' : MONTHS[Number(dates[0]!.slice(5, 7)) - 1] + ' '}– ${Number(dates[6]!.slice(8))}. ${MONTHS[Number(dates[6]!.slice(5, 7)) - 1]} ${dates[6]!.slice(0, 4)}`;

  const pages: PDFPage[] = [];
  const text = (page: PDFPage, value: string, x: number, y: number, size: number, font = regular, color = NAVY) => page.drawText(safe(font, value), { x, y, size, font, color });
  const centered = (page: PDFPage, value: string, cx: number, y: number, size: number, font = regular, color = NAVY) => {
    const v = safe(font, value);
    page.drawText(v, { x: cx - font.widthOfTextAtSize(v, size) / 2, y, size, font, color });
  };
  /** The text cut with "…" so it fits into the width. */
  const fit = (value: string, font: PDFFont, size: number, width: number) => {
    let v = safe(font, value);
    if (font.widthOfTextAtSize(v, size) <= width) return v;
    while (v.length > 1 && font.widthOfTextAtSize(`${v}…`, size) > width) v = v.slice(0, -1);
    return `${v.trimEnd()}…`;
  };
  const box = (page: PDFPage, x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>) => page.drawRectangle({ x, y, width: w, height: h, color, borderColor: LINE, borderWidth: 0.8 });

  const newPage = (title: string) => {
    const page = pdf.addPage([W, H]);
    pages.push(page);
    text(page, title, M, H - M - 8, 17, bold, RED);
    text(page, `${input.siteName} · KW ${kw} · ${range}`, M, H - M - 23, 9.5, bold, NAVY);
    const lh = 24;
    const lw = (lh * logo.width) / logo.height;
    page.drawImage(logo, { x: W - M - lw, y: H - M - lh + 4, width: lw, height: lh });
    // status pill under the logo
    const label = draft ? 'Entwurf' : 'Veröffentlicht';
    const pw = bold.widthOfTextAtSize(label, 7) + 14;
    page.drawRectangle({ x: W - M - pw, y: H - M - lh - 14, width: pw, height: 11, color: draft ? rgb(1, 0.93, 0.78) : rgb(0.86, 0.94, 0.88) });
    centered(page, label, W - M - pw / 2, H - M - lh - 11.5, 7, bold, draft ? WARN : OK);
    return page;
  };

  const labelW = 150;
  const colW = (W - 2 * M - labelW) / 14;
  const top = H - M - 44;
  const bottom = 40;

  const dayHeader = (page: PDFPage, labels: [string, string?]): number => {
    const y = top;
    box(page, M, y - 32, labelW, 32, HEAD);
    text(page, labels[0], M + 5, y - 20, 8, bold);
    if (labels[1]) text(page, labels[1], M + 80, y - 20, 8, bold);
    dates.forEach((d, i) => {
      const x = M + labelW + i * 2 * colW;
      const special = specials.get(d);
      box(page, x, y - 22, 2 * colW, 22, special ? rgb(0.98, 0.9, 0.9) : HEAD);
      centered(page, `${DAY_NAMES[i]} ${dm(d)}`, x + colW, y - 9, 7.4, bold);
      if (special) centered(page, fit(`${special.label}${special.closed ? ' · geschlossen' : ''}`, regular, 5.6, 2 * colW - 4), x + colW, y - 17.5, 5.6, bold, RED);
      box(page, x, y - 32, colW, 10, HEAD2);
      box(page, x + colW, y - 32, colW, 10, HEAD2);
      centered(page, 'Lunch', x + colW / 2, y - 29.5, 5.8, regular, MUTED);
      centered(page, 'Dinner', x + colW * 1.5, y - 29.5, 5.8, regular, MUTED);
    });
    return y - 32;
  };

  const covers = (s: Shift, w: { fromMin: number; toMin: number }) => s.userId !== null && s.startMin < w.toMin && s.endMin > w.fromMin;
  const peopleIn = (date: string, w: { fromMin: number; toMin: number }) => new Set(input.shifts.filter((s) => s.date === date && covers(s, w)).map((s) => s.userId)).size;
  const breakNote = (s: Shift) => (s.breakMin > 0 ? ` · P${s.breakMin}'` : '');

  // ---- Page 1: station plan ------------------------------------------------------------
  {
    let page = newPage('Dienstplan · Stationen');
    let y = dayHeader(page, ['STATIONEN']);
    const ensure = (need: number) => {
      if (y - need < bottom + 6) {
        page = newPage('Dienstplan · Stationen (Fortsetzung)');
        y = dayHeader(page, ['STATIONEN']);
      }
    };
    for (const station of stations) {
      const inStation = input.shifts.filter((s) => s.station === station.name);
      if (inStation.length === 0) continue;
      ensure(13 + 20);
      box(page, M, y - 13, W - 2 * M, 13, PAPER);
      page.drawRectangle({ x: M, y: y - 13, width: 4, height: 13, color: hex(station.color) });
      text(page, fit(station.title, bold, 7.5, W - 2 * M - 12), M + 9, y - 9.4, 7.5, bold);
      y -= 13;
      const labels = [...new Set(inStation.map((s) => s.roleLabel ?? 'Schicht'))].sort((a, b) => {
        const first = (l: string) => Math.min(...inStation.filter((s) => (s.roleLabel ?? 'Schicht') === l).map((s) => s.startMin));
        return first(a) - first(b);
      });
      for (const label of labels) {
        const rowShifts = inStation.filter((s) => (s.roleLabel ?? 'Schicht') === label);
        const cell = (d: string, lunch: boolean) => rowShifts.filter((s) => s.date === d && isLunch(s.startMin) === lunch).sort((a, b) => a.startMin - b.startMin);
        const most = Math.max(1, ...dates.flatMap((d) => [cell(d, true).length, cell(d, false).length]));
        const rowH = Math.max(17, most * 13.2 + 4.5);
        ensure(rowH);
        const ink = station.textColor ? hex(station.textColor) : NAVY;
        box(page, M, y - rowH, labelW, rowH, hex(station.color));
        const first = Math.min(...rowShifts.map((s) => s.startMin));
        text(page, `${formatTime(first)}`, M + 5, y - rowH / 2 - 2, 6.8, bold, ink);
        text(page, fit(label, regular, 7, labelW - 40), M + 33, y - rowH / 2 - 2, 7, regular, ink);
        dates.forEach((d, i) => {
          for (const lunch of [true, false]) {
            const x = M + labelW + i * 2 * colW + (lunch ? 0 : colW);
            const list = cell(d, lunch);
            box(page, x, y - rowH, colW, rowH, list.length ? hex(station.color) : GREY);
            // every person gets an equal band, centred in it (one person = centred in the whole cell),
            // and a thin line separates the persons
            const band = rowH / Math.max(1, list.length);
            list.forEach((s, k) => {
              const mid = y - k * band - band / 2;
              if (k > 0) page.drawLine({ start: { x: x + 4, y: y - k * band }, end: { x: x + colW - 4, y: y - k * band }, thickness: 0.5, color: ink, opacity: 0.35 });
              if (!s.userId) {
                centered(page, 'OFFEN', x + colW / 2, mid + 1.8, 6.6, bold, RED);
              } else {
                centered(page, fit(names.get(s.userId) ?? '?', bold, 6.8, colW - 3), x + colW / 2, mid + 1.8, 6.8, bold, ink);
              }
              centered(page, `${formatTime(s.startMin)}-${formatTime(s.endMin)}${breakNote(s)}`, x + colW / 2, mid - 5.4, 5.2, regular, ink);
            });
          }
        });
        y -= rowH;
      }
    }
    if (input.shifts.length === 0) text(page, 'Für diese Woche sind noch keine Schichten geplant.', M, y - 20, 9);
    // How many people work each service
    if (input.shifts.length > 0) {
      ensure(18);
      y -= 4;
      box(page, M, y - 14, labelW, 14, HEAD);
      text(page, 'Personen im Service', M + 5, y - 10, 7, bold);
      dates.forEach((d, i) => {
        for (const lunch of [true, false]) {
          const x = M + labelW + i * 2 * colW + (lunch ? 0 : colW);
          const n = peopleIn(d, lunch ? LUNCH_WINDOW : DINNER_WINDOW);
          box(page, x, y - 14, colW, 14, HEAD2);
          centered(page, n > 0 ? String(n) : '–', x + colW / 2, y - 10, 7.4, bold, n > 0 ? NAVY : FAINT);
        }
      });
    }
  }

  // ---- Page 2: plan by person ------------------------------------------------------------
  const byPerson = [...input.people].sort((a, b) => Number(a.employmentType === 'ON_CALL' || a.employmentType === 'MANAGEMENT') - Number(b.employmentType === 'ON_CALL' || b.employmentType === 'MANAGEMENT'));
  const minutesOf = (id: string) => input.shifts.filter((s) => s.userId === id).reduce((n, s) => n + shiftNetMinutes(s), 0);
  const absenceOn = (id: string, date: string) => absences.find((a) => a.userId === id && a.startDate <= date && date <= a.endDate);
  {
    let page = newPage('Dienstplan · Mitarbeitende');
    const nameW = 64;
    const contractW = 40;
    const hoursW = labelW - nameW - contractW;
    const headerFor = (p: PDFPage) => {
      const y = dayHeader(p, ['MITARBEITENDE']);
      // replace the single label block by three columns
      box(p, M, y, labelW, 32, HEAD);
      text(p, 'Name', M + 5, y + 12, 7.5, bold);
      text(p, 'Vertrag', M + nameW + 3, y + 12, 7.5, bold);
      text(p, 'Stunden', M + nameW + contractW + 3, y + 12, 7.5, bold);
      return y;
    };
    let y = headerFor(page);
    for (const person of byPerson) {
      const mine = input.shifts.filter((s) => s.userId === person.userId);
      const cell = (d: string, lunch: boolean) => mine.filter((s) => s.date === d && isLunch(s.startMin) === lunch).sort((a, b) => a.startMin - b.startMin);
      const most = Math.max(1, ...dates.flatMap((d) => [cell(d, true).length, cell(d, false).length]));
      const rowH = Math.max(22, most * 9 + 8);
      if (y - rowH < bottom + 30) {
        page = newPage('Dienstplan · Mitarbeitende (Fortsetzung)');
        y = headerFor(page);
      }
      box(page, M, y - rowH, nameW, rowH, PAPER);
      text(page, fit(person.name, bold, 8, nameW - 6), M + 4, y - rowH / 2 - 2.5, 8, bold);
      box(page, M + nameW, y - rowH, contractW, rowH, PAPER);
      const hasPensum = (person.employmentType === 'FULL_TIME' || person.employmentType === 'PART_TIME') && person.pensumPercent;
      text(page, fit(hasPensum ? `${person.pensumPercent} %` : person.employmentType === 'MANAGEMENT' ? 'Leitung' : EMPLOYMENT_LABEL[person.employmentType], regular, 6.8, contractW - 4), M + nameW + 3, y - rowH / 2 - 2.5, 6.8);
      // hours against the contract
      box(page, M + nameW + contractW, y - rowH, hoursW, rowH, PAPER);
      const worked = minutesOf(person.userId);
      const hx = M + nameW + contractW + 3;
      text(page, worked > 0 ? hoursText(worked) : '–', hx, y - rowH / 2 + 1, 7.5, bold, worked > 0 ? NAVY : FAINT);
      if (hasPensum) {
        const c = weeklyTargetCorridor(person.pensumPercent!);
        const tone = worked < c.minMin ? WARN : worked > c.maxMin ? RED : OK;
        const barW = hoursW - 8;
        page.drawRectangle({ x: hx, y: y - rowH / 2 - 8, width: barW, height: 3, color: rgb(0.85, 0.85, 0.83) });
        page.drawRectangle({ x: hx, y: y - rowH / 2 - 8, width: Math.min(barW, (worked / (c.maxMin * 1.15)) * barW), height: 3, color: tone });
      }
      dates.forEach((d, i) => {
        const x0 = M + labelW + i * 2 * colW;
        const away = absenceOn(person.userId, d);
        if (away && mine.every((s) => s.date !== d)) {
          // holiday / sick leave: one band over the whole day
          box(page, x0, y - rowH, 2 * colW, rowH, away.type === 'VACATION' ? rgb(0.84, 0.88, 0.95) : rgb(0.95, 0.86, 0.86));
          centered(page, ABSENCE_LABEL[away.type], x0 + colW, y - rowH / 2 - 2, 6.4, bold, away.type === 'VACATION' ? rgb(0.2, 0.3, 0.55) : RED);
          return;
        }
        for (const lunch of [true, false]) {
          const x = x0 + (lunch ? 0 : colW);
          const list = cell(d, lunch);
          if (list.length === 0) {
            box(page, x, y - rowH, colW, rowH, GREY);
            centered(page, '-', x + colW / 2, y - rowH / 2 - 2, 7, regular, FAINT);
          }
          list.forEach((s, k) => {
            const st = stationOf(s.station);
            const band = rowH / list.length;
            box(page, x, y - (k + 1) * band, colW, band, hex(st?.color ?? '#e3e1df'));
            const ink = st?.textColor ? hex(st.textColor) : NAVY;
            centered(page, `${formatTime(s.startMin)} - ${formatTime(s.endMin)}`, x + colW / 2, y - k * band - band / 2 - 0.5, 6, bold, ink);
            if (s.breakMin > 0) centered(page, `Pause ${s.breakMin}'`, x + colW / 2, y - k * band - band / 2 - 6.6, 4.8, regular, ink);
          });
        }
      });
      y -= rowH;
    }
    // totals per day
    if (y - 30 < bottom) {
      page = newPage('Dienstplan · Mitarbeitende (Fortsetzung)');
      y = headerFor(page);
    }
    y -= 3;
    for (const row of ['Personen', 'Stunden'] as const) {
      box(page, M, y - 13, labelW, 13, HEAD);
      text(page, row === 'Personen' ? 'Personen pro Tag' : 'Stunden pro Tag', M + 5, y - 9.5, 7, bold);
      dates.forEach((d, i) => {
        const x = M + labelW + i * 2 * colW;
        box(page, x, y - 13, 2 * colW, 13, HEAD2);
        const dayShifts = input.shifts.filter((s) => s.date === d && s.userId);
        const value = row === 'Personen' ? String(new Set(dayShifts.map((s) => s.userId)).size) : hoursText(dayShifts.reduce((n, s) => n + shiftNetMinutes(s), 0));
        centered(page, value, x + colW, y - 9.5, 7.2, bold);
      });
      y -= 13;
    }
    // Legend
    y -= 12;
    if (y - 28 < bottom) {
      page = newPage('Dienstplan · Mitarbeitende (Fortsetzung)');
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
    text(page, "P30' = Pause in Minuten, nicht zeitlich festgelegt: jede Person nimmt sie, wann sie möchte. Die Pause ist in den Stunden schon abgezogen.", M, y - 25, 6.4, regular, MUTED);

    // What the Leitung wants to know at a glance, in four short columns
    y -= 44;
    const colWidth = (W - 2 * M) / 4;
    const need = 14 + 5 * 10;
    if (y - need < bottom) {
      page = newPage('Dienstplan · Mitarbeitende (Fortsetzung)');
      y = top - 6;
    }
    const column = (index: number, heading: string, items: { t: string; c?: ReturnType<typeof rgb> }[]) => {
      const x = M + index * colWidth;
      page.drawRectangle({ x, y: y - 2, width: colWidth - 8, height: 0.8, color: RED });
      text(page, heading, x, y - 12, 7, bold, RED);
      items.slice(0, 5).forEach((it, k) => text(page, fit(it.t, regular, 7, colWidth - 12), x, y - 23 - k * 10, 7, regular, it.c ?? NAVY));
      if (items.length > 5) text(page, `… und ${items.length - 5} weitere`, x, y - 23 - 5 * 10, 6.4, regular, MUTED);
    };
    const weekAbs = absences.filter((a) => a.startDate <= dates[6]! && a.endDate >= dates[0]!);
    column(0, 'FERIEN & ABWESENHEIT', weekAbs.length ? weekAbs.map((a) => ({ t: `${names.get(a.userId) ?? '?'}: ${ABSENCE_LABEL[a.type]} ${dm(a.startDate < dates[0]! ? dates[0]! : a.startDate)}${a.endDate > a.startDate ? `–${dm(a.endDate > dates[6]! ? dates[6]! : a.endDate)}` : ''}` })) : [{ t: 'Keine', c: MUTED }]);
    const sp = dates.filter((d) => specials.has(d));
    column(1, 'BESONDERE TAGE', sp.length ? sp.map((d) => ({ t: `${weekdayShort(d)} ${dm(d)}: ${specials.get(d)!.label}${specials.get(d)!.closed ? ' (geschlossen)' : ''}` })) : [{ t: 'Keine', c: MUTED }]);
    const openShifts = input.shifts.filter((s) => !s.userId);
    column(2, 'OFFENE SCHICHTEN', openShifts.length ? openShifts.map((s) => ({ t: `${weekdayShort(s.date)} ${dm(s.date)} ${formatTime(s.startMin)}–${formatTime(s.endMin)} · ${s.station}`, c: RED })) : [{ t: 'Keine, alles besetzt', c: OK }]);
    const planned = input.shifts.filter((s) => s.userId);
    column(3, 'IN DIESER WOCHE', [
      { t: `${planned.length} Schichten · ${hoursText(planned.reduce((n, s) => n + shiftNetMinutes(s), 0))}` },
      { t: `${new Set(planned.map((s) => s.userId)).size} Personen im Einsatz` },
      ...(draft ? [{ t: 'Entwurf: noch nicht für Mitarbeitende sichtbar', c: WARN }] : []),
    ]);
  }

  // Footer on every page
  const stamp = `${input.siteName} · ${new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' }).format(input.generatedAt)}`;
  pages.forEach((p, i) => {
    // the draft mark lies on top of everything so it is never hidden by a coloured cell
    if (draft) p.drawText('ENTWURF', { x: 190, y: 110, size: 120, font: bold, color: RED, opacity: 0.07, rotate: degrees(28) });
    text(p, 'asiaway - Gastro App', M, 20, 6.5, regular, FAINT);
    centered(p, stamp, W / 2, 20, 6.5, regular, FAINT);
    const right = `Seite ${i + 1} / ${pages.length}`;
    text(p, right, W - M - regular.widthOfTextAtSize(right, 6.5), 20, 6.5, regular, FAINT);
  });
  return pdf.save();
}
