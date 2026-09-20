import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../../../server/db/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Health check for the container orchestrator and the load balancer.
 *
 * Checks that the database actually answers, not merely that the process is up:
 * a server that cannot reach its database must not be given traffic.
 */
export async function GET() {
  try {
    const { db, mode } = await getDatabase();
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: 'ok', database: mode });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', message: error instanceof Error ? error.message : 'unknown' },
      { status: 503 },
    );
  }
}
