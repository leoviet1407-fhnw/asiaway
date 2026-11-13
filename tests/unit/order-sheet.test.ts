import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { deliveryAddressLine, deliveryDayLabel, orderEmailText, quantityLabel, type OrderDocument } from '@/server/mail/order-document';
import { renderOrderPdf } from '@/server/pdf/order-pdf';

const base: OrderDocument = {
  number: 'B-2026-0001',
  createdAt: new Date('2026-11-13T10:00:00Z'),
  deliveryDate: '2026-11-17',
  note: null,
  location: { name: 'Winterthur', address: 'Archplatz 2, 8400 Winterthur', deliveryNote: null, phone: '044 000 00 00', contactEmail: 'b@example.ch' },
  supplier: { name: 'Prodega', customerNumber: '1234', orderEmail: 'o@example.ch', ccEmail: null },
  orderedBy: { name: 'Leitung', email: 'l@example.ch' },
  lines: [
    { department: 'KÜCHE', group: 'FOOD', supplierSku: '00590111', name: 'Sonnenblumenöl', qty: 3, quantityUnit: 'Karton', orderUnit: 'Karton zu 20l', note: null },
    { department: 'KÜCHE', group: 'GEMÜSE', supplierSku: null, name: 'Blumenkohl', qty: 5.5, quantityUnit: 'kg', orderUnit: 'kg', note: 'nur frische' },
  ],
};

describe('order sheet', () => {
  it('writes quantity, unit, delivery day and address like the supplier sheet', () => {
    expect(quantityLabel(base.lines[0]!)).toBe('3 Karton');
    expect(quantityLabel(base.lines[1]!)).toBe('5.5 kg');
    expect(quantityLabel({ qty: 2, quantityUnit: null })).toBe('2');
    expect(deliveryDayLabel('2026-11-17')).toBe('Dienstag, 17.11.2026');
    expect(deliveryDayLabel(null)).toBe('nächster Liefertag');
    expect(deliveryAddressLine(base)).toBe('Restaurant Winterthur, Archplatz 2, 8400 Winterthur');
  });

  it('the email shows the pack only when it adds something', () => {
    const text = orderEmailText(base);
    expect(text).toContain('3 Karton  Sonnenblumenöl (Karton zu 20l) [00590111]');
    expect(text).toContain('5.5 kg  Blumenkohl – nur frische');
    expect(text).not.toContain('Blumenkohl (kg)');
    expect(text).toContain('Gewünschte Lieferung: Dienstag, 17.11.2026');
  });

  it('renders a landscape PDF, and more pages for long orders', async () => {
    const one = await PDFDocument.load(await renderOrderPdf(base));
    expect(one.getPageCount()).toBe(1);
    expect(one.getPage(0).getWidth()).toBeGreaterThan(one.getPage(0).getHeight());
    const many = { ...base, lines: Array.from({ length: 60 }, (_, i) => ({ ...base.lines[0]!, name: `Artikel ${i + 1}` })) };
    expect((await PDFDocument.load(await renderOrderPdf(many))).getPageCount()).toBeGreaterThan(1);
  });
});
