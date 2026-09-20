import { NextResponse } from 'next/server';
import { db } from '../../../../server/db/index';
import { getAvailabilityList } from '../../../../server/services/menu-service';
import { handleApiError, withWaiter } from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return (await withWaiter(async () => {
      return NextResponse.json({ items: await getAvailabilityList(await db()) });
    })) as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
