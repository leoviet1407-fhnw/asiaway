import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors';
import { isOrderer } from '@/domain/roles';
import { todayIso } from '@/lib/dates';
import { currentPrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { closingsToCsv, listClosings } from '@/server/services/closing-service';

export const dynamic = 'force-dynamic';

/** CSV of one month for the accountant: /tagesabschluss/export?monat=2026-11 */
export async function GET(request: Request) {
  const p = await currentPrincipal();
  if (!p) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!isOrderer(p)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const url = new URL(request.url);
  const month = url.searchParams.get('monat') ?? todayIso().slice(0, 7);
  const ort = url.searchParams.get('ort') ?? undefined;
  try {
    const csv = closingsToCsv(await listClosings(await db(), p, { month, ...(ort ? { locationId: ort } : {}) }));
    return new NextResponse(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Tagesabschluesse-${month}.csv"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.code }, { status: 400 });
    throw error;
  }
}
