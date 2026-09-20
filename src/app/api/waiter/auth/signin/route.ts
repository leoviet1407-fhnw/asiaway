import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../server/db/index';
import { signIn, WAITER_COOKIE, WAITER_SESSION_HOURS } from '../../../../../server/auth/session';
import {
  COOKIE_BASE,
  apiError,
  enforceRateLimit,
  handleApiError,
  requestIpHash,
  userAgentHash,
} from '../../../../../server/http/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ email: z.string().email().max(255), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  try {
    const limited = await enforceRateLimit('auth.signin', 10, 60_000);
    if (limited) return limited;

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      // Same message as a bad password: the form must not reveal which field failed.
      return apiError('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    const { user, token } = await signIn(await db(), {
      email: parsed.data.email,
      password: parsed.data.password,
      ipHash: await requestIpHash(),
      userAgentHash: await userAgentHash(),
    });

    const response = NextResponse.json({ user });
    response.cookies.set(WAITER_COOKIE, token, {
      ...COOKIE_BASE,
      sameSite: 'strict',
      maxAge: WAITER_SESSION_HOURS * 3600,
    });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
