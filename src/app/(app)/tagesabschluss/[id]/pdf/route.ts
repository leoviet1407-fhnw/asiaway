import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors';
import { currentPrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { renderClosingPdf } from '@/server/pdf/closing-pdf';
import { getClosing } from '@/server/services/closing-service';

export const dynamic = 'force-dynamic';

/** The closing as a printable A4 PDF: /tagesabschluss/<id>/pdf */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await currentPrincipal();
  if (!p) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  try {
    const closing = await getClosing(await db(), p, id);
    const pdf = await renderClosingPdf(closing);
    return new NextResponse(Buffer.from(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Tagesabschluss-${closing.locationName}-${closing.businessDate}.pdf"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.code }, { status: error.code === 'FORBIDDEN' ? 403 : 404 });
    throw error;
  }
}
