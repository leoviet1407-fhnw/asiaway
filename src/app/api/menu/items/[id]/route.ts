import { NextResponse } from 'next/server';
import { db } from '../../../../../server/db/index';
import { getMenuItem } from '../../../../../server/services/menu-service';
import { parseLocale } from '../../../../../i18n/locales';
import { handleApiError } from '../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const locale = parseLocale(new URL(request.url).searchParams.get('lang'));
    return NextResponse.json(await getMenuItem(await db(), id, locale));
  } catch (error) {
    return handleApiError(error);
  }
}
