import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '../../../../../server/db/index';
import { signOut, WAITER_COOKIE } from '../../../../../server/auth/session';
import { handleApiError } from '../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const jar = await cookies();
    await signOut(await db(), jar.get(WAITER_COOKIE)?.value);
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(WAITER_COOKIE);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
