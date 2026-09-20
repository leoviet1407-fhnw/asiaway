import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '../../../server/db/index';
import { resolveScan } from '../../../server/services/session-service';
import { encodeCustomerCookie } from '../../../server/auth/customer-cookie';
import { CUSTOMER_COOKIE } from '../../../server/auth/session';
import { DomainError } from '../../../domain/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEVICE_COOKIE = 'aw_dev';

/**
 * The QR landing URL.
 *
 * A Route Handler rather than a page, because Next.js only permits setting
 * cookies here — and issuing the guest's signed session cookie is the entire
 * point of this request. Resolving happens server-side on the very first hit,
 * so the guest goes from camera straight to the menu with no extra tap.
 *
 * A retired or unknown code is sent to a friendly page that reveals nothing
 * about which tables exist.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const origin = new URL(request.url).origin;

  try {
    const jar = await cookies();
    const agent = request.headers.get('user-agent');

    const result = await resolveScan(await db(), {
      qrToken: token,
      existingDeviceToken: jar.get(DEVICE_COOKIE)?.value ?? null,
      userAgentHash: agent ? createHash('sha256').update(agent).digest('hex').slice(0, 32) : null,
    });

    const response = NextResponse.redirect(new URL('/menu', origin));
    const base = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };

    response.cookies.set(
      CUSTOMER_COOKIE,
      encodeCustomerCookie({
        sessionId: result.sessionId,
        tableId: result.tableId,
        deviceId: result.deviceId,
        iat: Math.floor(Date.now() / 1000),
      }),
      { ...base, maxAge: 60 * 60 * 12 },
    );

    // Lets the same phone rejoin its own anonymous device record on a re-scan.
    response.cookies.set(DEVICE_COOKIE, result.deviceToken, {
      ...base,
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.redirect(new URL('/qr-invalid', origin));
    }
    throw error;
  }
}
