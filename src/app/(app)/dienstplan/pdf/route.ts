import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors';
import { ROSTER_SITES, mondayOf } from '@/domain/roster';
import { todayIso } from '@/lib/dates';
import { currentPrincipal } from '@/server/auth/current';
import { db } from '@/server/db';
import { renderRosterPdf } from '@/server/pdf/roster-pdf';
import { getWeekView } from '@/server/services/roster-service';

export const dynamic = 'force-dynamic';

/** The week as PDF: /dienstplan/pdf?site=winterthur&woche=2026-11-09 (staff: published weeks only). */
export async function GET(request: Request) {
  const p = await currentPrincipal();
  if (!p) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const url = new URL(request.url);
  const site = ROSTER_SITES.find((s) => s.id === url.searchParams.get('site'));
  const week = mondayOf(url.searchParams.get('woche') ?? todayIso());
  if (!site) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const view = await getWeekView(await db(), p, site.id, week);
    if (view.hidden) return NextResponse.json({ error: 'NOT_PUBLISHED' }, { status: 404 });
    const pdf = await renderRosterPdf({ siteId: site.id, siteName: site.name, weekStart: week, people: view.people, shifts: view.shifts, generatedAt: new Date() });
    return new NextResponse(Buffer.from(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Asiaway-Service-${week}-${site.name}.pdf"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.code }, { status: error.code === 'FORBIDDEN' ? 403 : 404 });
    throw error;
  }
}
