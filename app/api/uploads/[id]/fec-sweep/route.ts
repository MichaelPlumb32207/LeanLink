import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withUserDb } from '@/lib/db';
import { FEC_REQUEST_INTERVAL_MS, triggerFecSweepWorker } from '@/lib/fec/sweep-runner';

export interface FecSweepJobRow {
  id: string;
  upload_id: string;
  status: string;
  processed_count: number;
  failed_count: number;
  hits_count: number;
  total_count: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function hitRatePct(job: FecSweepJobRow): number {
  if (job.processed_count === 0) return 0;
  return Math.round((job.hits_count / job.processed_count) * 1000) / 10;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;

    const { job, sampleHits } = await withUserDb(userEmail, async (client) => {
      const jobRes = await client.query<FecSweepJobRow>(
        `SELECT *
         FROM fec_sweep_jobs
         WHERE upload_id = $1 AND user_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [uploadId, userEmail],
      );

      const job = jobRes.rows[0] ?? null;
      if (!job) return { job: null, sampleHits: [] };

      const hitsRes = await client.query(
        `SELECT row_index, contributor_name, match_level, result_count, contributions
         FROM fec_lookup_results
         WHERE sweep_job_id = $1 AND has_hits = TRUE
         ORDER BY row_index
         LIMIT 25`,
        [job.id],
      );

      return { job, sampleHits: hitsRes.rows };
    });

    if (!job) {
      return NextResponse.json({ job: null, sample_hits: [], hit_rate_pct: 0 });
    }

    return NextResponse.json({
      job,
      hit_rate_pct: hitRatePct(job),
      sample_hits: sampleHits,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch FEC sweep status';
    if (message.includes('fec_sweep_jobs')) {
      return NextResponse.json(
        {
          error: 'FEC sweep tables missing',
          hint: 'Apply migrations/003_fec_sweep.sql to your database.',
          job: null,
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireUser();
    const userEmail = session.user.email;
    const { id: uploadId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action?: string };

    if (body.action === 'cancel') {
      const cancelled = await withUserDb(userEmail, async (client) => {
        const res = await client.query<{ id: string }>(
          `UPDATE fec_sweep_jobs
           SET status = 'cancelled', completed_at = NOW(), last_heartbeat_at = NOW()
           WHERE upload_id = $1 AND user_id = $2 AND status IN ('queued', 'running')
           RETURNING id`,
          [uploadId, userEmail],
        );
        return res.rows[0]?.id ?? null;
      });

      if (!cancelled) {
        return NextResponse.json({ error: 'No active FEC sweep to cancel' }, { status: 404 });
      }

      return NextResponse.json({ jobId: cancelled, status: 'cancelled' });
    }

    const result = await withUserDb(userEmail, async (client) => {
      const uploadRes = await client.query<{ row_count: number }>(
        `SELECT row_count FROM voter_uploads WHERE id = $1 AND user_id = $2`,
        [uploadId, userEmail],
      );
      if (uploadRes.rows.length === 0) {
        return { error: 'Upload not found' as const };
      }

      const activeRes = await client.query(
        `SELECT id FROM fec_sweep_jobs
         WHERE upload_id = $1 AND user_id = $2 AND status IN ('queued', 'running')
         LIMIT 1`,
        [uploadId, userEmail],
      );
      if (activeRes.rows.length > 0) {
        return { error: 'FEC sweep already running', jobId: activeRes.rows[0].id as string };
      }

      const total = uploadRes.rows[0].row_count;
      const jobRes = await client.query<{ id: string }>(
        `INSERT INTO fec_sweep_jobs (upload_id, user_id, status, total_count)
         VALUES ($1, $2, 'queued', $3)
         RETURNING id`,
        [uploadId, userEmail, total],
      );

      return { jobId: jobRes.rows[0].id, total_count: total };
    });

    if ('error' in result) {
      if (result.error === 'Upload not found') {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      const existing = await withUserDb(userEmail, async (client) => {
        const res = await client.query<FecSweepJobRow>(
          `SELECT * FROM fec_sweep_jobs WHERE id = $1 AND user_id = $2`,
          [result.jobId, userEmail],
        );
        return res.rows[0] ?? null;
      });
      return NextResponse.json(
        {
          error: result.error,
          jobId: result.jobId,
          job: existing,
          hit_rate_pct: existing ? hitRatePct(existing) : 0,
        },
        { status: 409 },
      );
    }

    await triggerFecSweepWorker(result.jobId);

    return NextResponse.json({
      jobId: result.jobId,
      status: 'queued',
      total_count: result.total_count,
      message: `FEC sweep started for ${result.total_count} voters (free API, throttled ~${Math.round(3_600_000 / FEC_REQUEST_INTERVAL_MS)}/hour).`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to start FEC sweep';
    if (message.includes('fec_sweep_jobs')) {
      return NextResponse.json(
        {
          error: 'FEC sweep tables missing',
          hint: 'Apply migrations/003_fec_sweep.sql to your database.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}