import { NextResponse } from 'next/server';
import { isBatchInferenceEnabled } from '@/lib/batch-inference';
import { pool } from '@/lib/db';
import { triggerWorker } from '@/lib/job-runner';

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;
  return request.headers.get('x-vercel-cron') === '1' && !!process.env.CRON_SECRET;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE voter_records
       SET status = 'pending', updated_at = NOW()
       WHERE status = 'processing'
         AND updated_at < NOW() - INTERVAL '15 minutes'`,
    );

    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM processing_jobs
       WHERE status IN ('queued', 'running')
         AND (
           last_heartbeat_at IS NULL
           OR last_heartbeat_at < NOW() - INTERVAL '10 minutes'
         )`,
    );

    await client.query('COMMIT');

    let retriggered = 0;
    if (isBatchInferenceEnabled()) {
      for (const row of rows) {
        await triggerWorker(row.id);
        retriggered += 1;
      }
    }

    return NextResponse.json({
      retriggered,
      batch_inference_enabled: isBatchInferenceEnabled(),
      stale_jobs: rows.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cron sweeper failed', error);
    return NextResponse.json({ error: 'Sweeper failed' }, { status: 500 });
  } finally {
    client.release();
  }
}