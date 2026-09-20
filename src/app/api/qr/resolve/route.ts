import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { db } from '../../../../server/db/index';
import { resolveScan } from '../../../../server/services/session-service';
import { encodeCustomerCookie } from '../../../../server/auth/customer-cookie';
import { CUSTOMER_COOKIE } from '../../../../server/auth/session';
import {
  COOKIE_BASE,
  enforceRateLimit,
  handleApiError,
  userAgentHash,
} from '../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ qrToken: z.string().min(1).max(64) });

const DEVICE_COOKIE = 'aw_dev';

/**
 * Resolves a scanned QR token to a dining session and issues the guest's signed
 * session cookie.
 *
 * This is the ONLY endpoint that accepts a QR token. Everything afterwards
 * authorises against the cookie, which is what keeps one table's session out of
 * another table's reach.
 */
export async function POST(request: Request) {
  try {
    const limited = await enforceRateLimit('qr.resolve', 10, 60_000);
    if (limited) return limited;

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_FAILED', message: 'A QR token is required' } },
        { status: 400 },
      );
    }

    const jar = await cookies();
    const result = await resolveScan(await db(), {
      qrToken: parsed.data.qrToken,
      existingDeviceToken: jar.get(DEVICE_COOKIE)?.value ?? null,
      userAgentHash: await userAgentHash(),
    });

    const response = NextResponse.json({
      tableNumber: result.tableNumber,
      tableLabel: result.tableLabel,
      isNewSession: result.isNewSession,
      isCombined: result.isCombined,
      scannedTableNumber: result.scannedTableNumber,
    });

    response.cookies.set(
      CUSTOMER_COOKIE,
      encodeCustomerCookie({
        sessionId: result.sessionId,
        tableId: result.tableId,
        deviceId: result.deviceId,
        iat: Math.floor(Date.now() / 1000),
      }),
      { ...COOKIE_BASE, sameSite: 'lax', maxAge: 60 * 60 * 12 },
    );

    // Lets the same phone rejoin its own device record on a re-scan.
    response.cookies.set(DEVICE_COOKIE, result.deviceToken, {
      ...COOKIE_BASE,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
