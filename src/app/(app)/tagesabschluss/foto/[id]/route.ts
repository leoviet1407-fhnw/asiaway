import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors';
import { currentPrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { getClosingPhoto } from '@/server/services/closing-service';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await currentPrincipal();
  if (!p) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  try {
    const { id } = await params;
    const photo = await getClosingPhoto(await db(), p, id);
    return new NextResponse(new Uint8Array(photo.data), { headers: { 'Content-Type': photo.mime, 'Cache-Control': 'private, max-age=86400' } });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.code }, { status: 404 });
    throw error;
  }
}
