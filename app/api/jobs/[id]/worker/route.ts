import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { withUserDb } from '@/lib/db';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { VoterHistorySummary } from '@/lib/fl-voter-history';
import type { BallotFavors } from '@/lib/fl-voter-history';
import { inferLean } from '@/lib/inference';
import { getWorkerDeadlineMs, triggerWorker, WORKER_BATCH_CLAIM_SIZE } from '@/lib/job-runner';

export const maxDuration = 800;

type ClaimedRow = {
  id: string;
  raw_data: ParsedFlVoterRecord;
  voter_hash: string;
  upload_id: string;
  history_summary: VoterHistorySummary | null;
  ballot_favors: BallotFavors;
};

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return token === process.env.INTERNAL_JOB_SECRET;
}

async function claimRows(client: PoolClient, jobId: string, userId: string, limit: number) {
  const { rows } = await client.query<ClaimedRow>(
    `WITH claimed AS (
       SELECT vr.id
       FROM voter_records vr
       WHERE vr.upload_id = (SELECT upload_id FROM processing_jobs WHERE id = $1 AND user_id = $2)
         AND vr.user_id = $2
         AND vr.status = 'pending'
       ORDER BY vr.row_index
       LIMIT $3
       FOR UPDATE OF vr SKIP LOCKED
     )
     UPDATE voter_records vr
     SET status = 'processing', updated_at = NOW()
     FROM claimed
     JOIN voter_uploads u ON u.id = vr.upload_id
     WHERE vr.id = claimed.id
     RETURNING vr.id, vr.raw_data, vr.voter_hash, vr.upload_id, vr.history_summary, u.ballot_favors`,
    [jobId, userId, limit],
  );
  return rows;
}

async function processRow(userId: string, row: ClaimedRow) {
  await withUserDb(userId, async (client) => {
    const record = row.raw_data;
    const inference = inferLean(record, row.history_summary, row.ballot_favors);

    await client.query(
      `INSERT INTO lean_results
         (upload_id, voter_record_id, user_id, voter_hash, lean, confidence, evidence, matched_social, audit_log,
          turnout_propensity, turnout_score, primary_engagement, opposition_mobilization_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (voter_record_id) DO UPDATE SET
         lean = EXCLUDED.lean,
         confidence = EXCLUDED.confidence,
         evidence = EXCLUDED.evidence,
         matched_social = EXCLUDED.matched_social,
         audit_log = EXCLUDED.audit_log,
         turnout_propensity = EXCLUDED.turnout_propensity,
         turnout_score = EXCLUDED.turnout_score,
         primary_engagement = EXCLUDED.primary_engagement,
         opposition_mobilization_score = EXCLUDED.opposition_mobilization_score`,
      [
        row.upload_id,
        row.id,
        userId,
        row.voter_hash,
        inference.lean,
        inference.confidence,
        JSON.stringify(inference.evidence),
        JSON.stringify(inference.matched_social),
        JSON.stringify(inference.audit),
        inference.turnout_propensity,
        inference.turnout_score,
        inference.primary_engagement,
        inference.opposition_mobilization_score,
      ],
    );

    await client.query(
      `UPDATE voter_records SET status = 'completed', updated_at = NOW(), error_message = NULL
       WHERE id = $1`,
      [row.id],
    );
  });
}

async function markRowFailed(userId: string, rowId: string, message: string) {
  await withUserDb(userId, async (client) => {
    await client.query(
      `UPDATE voter_records
       SET status = 'failed', attempts = attempts + 1, error_message = $2, updated_at = NOW()
       WHERE id = $1`,
      [rowId, message],
    );
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: jobId } = await context.params;
  const userEmail = process.env.ALLOWED_USER_EMAIL!;
  const deadline = getWorkerDeadlineMs();
  let processedThisRun = 0;
  let failedThisRun = 0;

  try {
    const outcome = await withUserDb(userEmail, async (client) => {
      const jobRes = await client.query<{
        id: string;
        user_id: string;
        upload_id: string;
        status: string;
        total_count: number;
      }>(
        `SELECT id, user_id, upload_id, status, total_count
         FROM processing_jobs WHERE id = $1`,
        [jobId],
      );

      if (jobRes.rows.length === 0) {
        return { notFound: true as const };
      }

      const job = jobRes.rows[0];
      if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
        return { job, remaining: 0, done: true as const };
      }

      await client.query(
        `UPDATE processing_jobs
         SET status = 'running', started_at = COALESCE(started_at, NOW()), last_heartbeat_at = NOW()
         WHERE id = $1`,
        [jobId],
      );

      return { job, remaining: -1, done: false as const, claimed: [] as ClaimedRow[] };
    });

    if ('notFound' in outcome && outcome.notFound) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (outcome.done) {
      return NextResponse.json({ jobId, status: 'completed', remaining: 0 });
    }

    const job = outcome.job;

    while (Date.now() < deadline) {
      const claimed = await withUserDb(userEmail, (client) =>
        claimRows(client, jobId, job.user_id, WORKER_BATCH_CLAIM_SIZE),
      );
      if (claimed.length === 0) break;

      for (const row of claimed) {
        if (Date.now() >= deadline) break;
        try {
          await processRow(job.user_id, row);
          processedThisRun += 1;
        } catch (error) {
          failedThisRun += 1;
          const message = error instanceof Error ? error.message : 'Unknown processing error';
          await markRowFailed(job.user_id, row.id, message);
        }
      }

      await withUserDb(userEmail, (client) =>
        client.query(
          `UPDATE processing_jobs
           SET processed_count = (
                 SELECT COUNT(*) FROM voter_records
                 WHERE upload_id = $2 AND user_id = $3 AND status = 'completed'
               ),
               failed_count = (
                 SELECT COUNT(*) FROM voter_records
                 WHERE upload_id = $2 AND user_id = $3 AND status = 'failed'
               ),
               last_heartbeat_at = NOW()
           WHERE id = $1`,
          [jobId, job.upload_id, job.user_id],
        ),
      );
    }

    const pendingRes = await withUserDb(userEmail, (client) =>
      client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM voter_records
         WHERE upload_id = $1 AND user_id = $2 AND status IN ('pending', 'processing')`,
        [job.upload_id, job.user_id],
      ),
    );
    const remaining = Number(pendingRes.rows[0]?.count ?? 0);

    if (remaining === 0) {
      await withUserDb(userEmail, async (client) => {
        await client.query(
          `UPDATE processing_jobs
           SET status = 'completed', completed_at = NOW(), last_heartbeat_at = NOW()
           WHERE id = $1`,
          [jobId],
        );
        await client.query(`UPDATE voter_uploads SET status = 'completed' WHERE id = $1`, [job.upload_id]);
      });
    } else {
      await triggerWorker(jobId);
    }

    return NextResponse.json({
      jobId,
      processedThisRun,
      failedThisRun,
      remaining,
      status: remaining === 0 ? 'completed' : 'running',
    });
  } catch (error) {
    console.error('Worker failed', jobId, error);
    return NextResponse.json({ error: 'Worker failed' }, { status: 500 });
  }
}