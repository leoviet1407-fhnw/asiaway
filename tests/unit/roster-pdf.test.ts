import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { orderPeople, renderRosterPdf } from '@/server/pdf/roster-pdf';
import type { RosterPerson, Shift } from '@/domain/roster';

const person = (userId: string, over: Partial<RosterPerson> = {}): RosterPerson => ({ userId, name: userId, employmentType: 'FULL_TIME', pensumPercent: 100, ...over });
const shift = (id: string, userId: string | null, date: string, start: number, end: number, station = 'EG Thai', breakMin = 0): Shift => ({ id, userId, date, startMin: start, endMin: end, breakMin, station, roleLabel: null });

describe('roster PDF', () => {
  const people = [person('Anna'), person('Ben', { employmentType: 'PART_TIME', pensumPercent: 80 }), person('Cem', { employmentType: 'ON_CALL', pensumPercent: null }), person('Dora', { employmentType: 'MANAGEMENT', pensumPercent: null })];
  const shifts = [
    shift('1', 'Anna', '2026-12-21', 630, 870),
    shift('2', 'Anna', '2026-12-21', 1050, 1320),
    shift('3', 'Ben', '2026-12-22', 630, 1080, 'Buffet', 30),
    shift('4', null, '2026-12-23', 1050, 1320, '1. OG'), // an open shift
  ];

  it('renders two pages with holidays, special days, the notes and the draft mark', async () => {
    const pdf = await renderRosterPdf({
      siteId: 'winterthur', siteName: 'Winterthur', weekStart: '2026-12-21', people, shifts, generatedAt: new Date('2026-12-14T09:00:00Z'),
      status: 'DRAFT',
      absences: [{ userId: 'Cem', startDate: '2026-12-22', endDate: '2026-12-24', type: 'VACATION' }, { userId: 'Dora', startDate: '2026-12-25', endDate: '2026-12-25', type: 'SICK' }],
      specialDays: [{ date: '2026-12-25', label: 'Weihnachten', closed: true }],
    });
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
  });

  it('renders an empty published week and a week without people', async () => {
    const a = await renderRosterPdf({ siteId: 'oerlikon', siteName: 'Oerlikon', weekStart: '2026-12-28', people, shifts: [], generatedAt: new Date(), status: 'PUBLISHED' });
    const b = await renderRosterPdf({ siteId: 'oerlikon', siteName: 'Oerlikon', weekStart: '2026-12-28', people: [], shifts: [], generatedAt: new Date() });
    expect(a.byteLength).toBeGreaterThan(2000);
    expect(b.byteLength).toBeGreaterThan(2000);
  });

  it('orders people: Leitung on top, then Pensum from high to low, Aushilfen at the bottom', () => {
    const mix = [
      person('Zoe', { employmentType: 'ON_CALL', pensumPercent: null }),
      person('Yen', { employmentType: 'PART_TIME', pensumPercent: 70 }),
      person('Verni', { employmentType: 'PART_TIME', pensumPercent: 50 }),
      person('Xuan', { employmentType: 'MANAGEMENT', pensumPercent: null }),
      person('Mersi', { employmentType: 'PART_TIME', pensumPercent: 80 }),
      person('April', { employmentType: 'FULL_TIME', pensumPercent: 100 }),
      person('Belle', { employmentType: 'PART_TIME', pensumPercent: 80 }),
      person('Anna', { employmentType: 'ON_CALL', pensumPercent: null }),
      person('Edmond', { employmentType: 'FULL_TIME', pensumPercent: 100 }),
    ];
    expect(orderPeople(mix).map((p) => p.name)).toEqual(['Xuan', 'April', 'Edmond', 'Belle', 'Mersi', 'Yen', 'Verni', 'Anna', 'Zoe']);
  });
});
