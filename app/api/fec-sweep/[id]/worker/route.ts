import { NextResponse } from 'next/server';
import { withUserDb } from '@/lib/db';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import {
  claimFecSweepRows,
  fecSweepRemainingCount,
  getFecSweepDeadlineMs,
  markFecSweepRowFailed,
  processFecSweepRow,
  refreshFecSweepJobCounts,
  sleep,
  FEC_REQUEST_INTERVAL_MS,
  triggerFecSweepWorker,
} from '@/lib/fec/sweep-runner';

export const maxDuration = 800;

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return token === process.env.INTERNAL_JOB_SECRET;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: jobId } = await context.params;
  const userEmail = process.env.ALLOWED_USER_EMAIL!;
  const deadline = getFecSweepDeadlineMs();
  let processedThisRun = 0;
  let failedThisRun = 0;

  try {
    const job = await withUserDb(userEmail, async (client) => {
      const res = await client.query<{
        id: string;
        user_id: string;
        upload_id: string;
        status: string;
      }>(
        `SELECT id, user_id, upload_id, status FROM fec_sweep_jobs WHERE id = $1`,
        [jobId],
      );
      return res.rows[0] ?? null;
    });

    if (!job) {
      return NextResponse.json({ error: 'FEC sweep job not found' }, { status: 404 });
    }

    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
      return NextResponse.json({ jobId, status: job.status, remaining: 0 });
    }

    await withUserDb(userEmail, (client) =>
      client.query(
        `UPDATE fec_sweep_jobs
         SET status = 'running', started_at = COALESCE(started_at, NOW()), last_heartbeat_at = NOW()
         WHERE id = $1`,
        [jobId],
      ),
    );

    while (Date.now() < deadline) {
      const statusRes = await withUserDb(userEmail, (client) =>
        client.query<{ status: string }>(
          `SELECT status FROM fec_sweep_jobs WHERE id = $1`,
          [jobId],
        ),
      );
      if (statusRes.rows[0]?.status === 'cancelled') break;

      const claimed = await withUserDb(userEmail, (client) =>
        claimFecSweepRows(client, jobId, job.user_id, job.upload_id, 1),
      );
      if (claimed.length === 0) break;

      const row = claimed[0];
      try {
        await withUserDb(userEmail, async (client) => {
          const patterns = await loadLeanPatterns(client, job.user_id);
          return processFecSweepRow(client, jobId, job.user_id, row, patterns);
        });
        processedThisRun += 1;
      } catch (error) {
        failedThisRun += 1;
        const message = error instanceof Error ? error.message : 'FEC lookup failed';
        await withUserDb(userEmail, (client) =>
          markFecSweepRowFailed(client, jobId, job.user_id, row, message),
        );
      }

      await withUserDb(userEmail, (client) => refreshFecSweepJobCounts(client, jobId));
      await sleep(FEC_REQUEST_INTERVAL_MS);
    }

    const remaining = await withUserDb(userEmail, (client) =>
      fecSweepRemainingCount(client, jobId, job.upload_id, job.user_id),
    );

    const finalStatus = await withUserDb(userEmail, async (client) => {
      const current = await client.query<{ status: string }>(
        `SELECT status FROM fec_sweep_jobs WHERE id = $1`,
        [jobId],
      );
      if (current.rows[0]?.status === 'cancelled') {
        return 'cancelled';
      }

      if (remaining === 0) {
        await client.query(
          `UPDATE fec_sweep_jobs
           SET status = 'completed', completed_at = NOW(), last_heartbeat_at = NOW()
           WHERE id = $1`,
          [jobId],
        );
        return 'completed';
      }

      void triggerFecSweepWorker(jobId);
      return 'running';
    });

    return NextResponse.json({
      jobId,
      processedThisRun,
      failedThisRun,
      remaining,
      status: finalStatus,
    });
  } catch (error) {
    console.error('FEC sweep worker failed', jobId, error);
    const message = error instanceof Error ? error.message : 'FEC sweep worker failed';
    try {
      await withUserDb(userEmail, (client) =>
        client.query(
          `UPDATE fec_sweep_jobs
           SET status = 'failed', error_message = $2, completed_at = NOW(), last_heartbeat_at = NOW()
           WHERE id = $1 AND status IN ('queued', 'running')`,
          [jobId, message.slice(0, 500)],
        ),
      );
    } catch (updateError) {
      console.error('Failed to mark FEC sweep job failed', jobId, updateError);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}