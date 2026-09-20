import { NextResponse } from 'next/server';
import { db } from '../../../server/db/index';
import { getAllergenLegend } from '../../../server/services/menu-service';
import { parseLocale } from '../../../i18n/locales';
import { handleApiError } from '../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const locale = parseLocale(new URL(request.url).searchParams.get('lang'));
    return NextResponse.json({ allergens: await getAllergenLegend(await db(), locale) });
  } catch (error) {
    return handleApiError(error);
  }
}
