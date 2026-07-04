import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { retryFailedFecRows } from '@/lib/fec/retry-failed';

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return request.headers.get('x-vercel-cron') === '1' && !!process.env.CRON_SECRET;
}

/**
 * Background retry of FEC lookups that failed on a transient API error. Runs on
 * a cron; each recovered hit lands in the evidence ledger and settles/bills like
 * a normal sweep. Bounded by attempt cap + spacing + per-run budget in
 * `retryFailedFecRows`.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await retryFailedFecRows(pool, {
      limit: 8,
      maxAttempts: 8,
      minMinutesBetween: 10,
      budgetMs: 50_000,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // fec_lookup_results.retry_attempts (migration 010) may not be applied yet.
    const message = error instanceof Error ? error.message : 'FEC retry failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
