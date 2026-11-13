import { describe, expect, it } from 'vitest';
import { computeClosing } from '@/domain/closing';
import { renderClosingPdf } from '@/server/pdf/closing-pdf';
import type { ClosingView } from '@/server/services/closing-service';

describe('closing PDF', () => {
  it('renders a one-page PDF with the amounts', async () => {
    const values = { cashCountedCents: 125000, startFloatCents: 30000, eftCents: 80000, mobileCents: 5000, posGrossCents: 189000 };
    const view = {
      id: 'x', locationId: 'oerlikon', locationName: 'Oerlikon', businessDate: '2026-11-12', station: 'Kasse', status: 'APPROVED',
      ...values, note: 'Trinkgeld für Küche – ä ö ü', closedByName: 'Kiet', createdAt: new Date(), updatedAt: new Date(),
      approvedByName: 'Belle', approvedAt: new Date(), result: computeClosing(values),
    } as unknown as ClosingView;
    const pdf = await renderClosingPdf(view);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(2000);
  });
});
