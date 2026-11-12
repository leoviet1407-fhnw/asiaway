import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors';
import { currentPrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { orderPdf } from '@/server/services/order-service';

export const dynamic = 'force-dynamic';

/** The archived PDF of a sent order, or a preview of a draft. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await currentPrincipal();
  if (!p) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  try {
    const { id } = await params;
    const { filename, data } = await orderPdf(await db(), p, id);
    return new NextResponse(Buffer.from(data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.code }, { status: error.code === 'FORBIDDEN' ? 403 : 404 });
    throw error;
  }
}
