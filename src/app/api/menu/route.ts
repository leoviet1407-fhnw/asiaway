import { NextResponse } from 'next/server';
import { db } from '../../../server/db/index';
import { getMenu } from '../../../server/services/menu-service';
import { parseLocale } from '../../../i18n/locales';
import { handleApiError } from '../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The menu is public: a guest must be able to read it the moment they scan,
 * before any order exists. Availability here is advisory and re-checked at
 * submit, which is the only check that decides anything.
 */
export async function GET(request: Request) {
  try {
    const locale = parseLocale(new URL(request.url).searchParams.get('lang'));
    const categories = await getMenu(await db(), locale);
    return NextResponse.json(
      { locale, categories },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
