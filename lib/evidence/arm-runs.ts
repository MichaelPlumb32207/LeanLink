/**
 * Per-arm run tracking (migration 014, D-029 Phase B) — the shared progress
 * ledger behind the dashboard's current-inning panel. Every runner (API action
 * or CLI script) starts a run, heartbeats at least once per chunk with absolute
 * cumulative counts, and finishes with a terminal status. The FEC API sweep is
 * NOT written here — its fec_sweep_jobs rows are normalized into the same shape
 * at read time (getUploadEvidenceSummary).
 *
 * Every helper must run inside a transaction that has already set
 * app.current_user (RLS) — callers own transaction boundaries.
 */
import type { PoolClient } from 'pg';

/**
 * The waterfall claim predicate, applied to `voter_records vr`: accepted →
 * never claim; settled + re-enrolled → claim anyway; otherwise unsettled only.
 * MUST stay in sync with the inline copies in claimFecSweepRows,
 * runFecIndexChunk, and runFreePassForUpload (see CLAUDE.md).
 */
export const CLAIM_ELIGIBLE_PREDICATE = `NOT EXISTS (
  SELECT 1 FROM voter_lean_fusion vlf
  WHERE vlf.voter_record_id = vr.id
    AND (vlf.review_status = 'accepted'
         OR (vlf.settled_tier IS NOT NULL
             AND vlf.research_status IS DISTINCT FROM 're_enrolled'))
)`;

/** Heartbeats older than this are reaped as failed by the next startArmRun. */
const STALE_RUN_MINUTES = 10;

export interface ArmRunCounts {
  processed: number;
  failed?: number;
  hits: number;
  confirmed: number;
  leanSignals: number;
}

/** The pool the next arm would claim right now — the run's total_count. */
export async function countEligibleVoters(
  client: PoolClient,
  uploadId: string,
  userId: string,
): Promise<number> {
  const res = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM voter_records vr
     WHERE vr.upload_id = $1 AND vr.user_id = $2
       AND ${CLAIM_ELIGIBLE_PREDICATE}`,
    [uploadId, userId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

/**
 * Start a run: reap stale actives first, then claim the one-active-run slot.
 * Returns the run id, or null when a live run already holds the slot (caller
 * reports "already running" — mirrors the FEC sweep route's 409).
 */
export async function startArmRun(
  client: PoolClient,
  args: {
    uploadId: string;
    userId: string;
    arm: string;
    runner: string;
    totalCount: number;
    meta?: Record<string, unknown>;
  },
): Promise<string | null> {
  await client.query(
    `UPDATE arm_runs
     SET status = 'failed', error_message = 'stale heartbeat (reaped by next run)',
         completed_at = NOW()
     WHERE upload_id = $1 AND arm = $2 AND status IN ('queued','running')
       AND (last_heartbeat_at IS NULL OR last_heartbeat_at < NOW() - INTERVAL '${STALE_RUN_MINUTES} minutes')`,
    [args.uploadId, args.arm],
  );
  const res = await client.query<{ id: string }>(
    `INSERT INTO arm_runs (upload_id, user_id, arm, runner, status, total_count, meta, started_at, last_heartbeat_at)
     VALUES ($1, $2, $3, $4, 'running', $5, $6, NOW(), NOW())
     ON CONFLICT (upload_id, arm) WHERE status IN ('queued','running') DO NOTHING
     RETURNING id`,
    [
      args.uploadId,
      args.userId,
      args.arm,
      args.runner,
      args.totalCount,
      args.meta ? JSON.stringify(args.meta) : null,
    ],
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Absolute cumulative counts for this run — call at least once per chunk.
 * Optional `meta` replaces `arm_runs.meta` (used by refuse-worker to persist
 * `processed_committees` on every heartbeat so a hard kill stays resume-safe).
 */
export async function heartbeatArmRun(
  client: PoolClient,
  runId: string,
  counts: ArmRunCounts,
  opts?: { meta?: Record<string, unknown> },
): Promise<void> {
  if (opts?.meta !== undefined) {
    await client.query(
      `UPDATE arm_runs
       SET processed_count = $2, failed_count = $3, hits_count = $4,
           confirmed_count = $5, lean_signal_count = $6,
           status = 'running', last_heartbeat_at = NOW(),
           meta = $7
       WHERE id = $1`,
      [
        runId,
        counts.processed,
        counts.failed ?? 0,
        counts.hits,
        counts.confirmed,
        counts.leanSignals,
        JSON.stringify(opts.meta),
      ],
    );
    return;
  }
  await client.query(
    `UPDATE arm_runs
     SET processed_count = $2, failed_count = $3, hits_count = $4,
         confirmed_count = $5, lean_signal_count = $6,
         status = 'running', last_heartbeat_at = NOW()
     WHERE id = $1`,
    [runId, counts.processed, counts.failed ?? 0, counts.hits, counts.confirmed, counts.leanSignals],
  );
}

export async function finishArmRun(
  client: PoolClient,
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  errorMessage?: string,
): Promise<void> {
  await client.query(
    `UPDATE arm_runs
     SET status = $2, error_message = COALESCE($3, error_message), completed_at = NOW()
     WHERE id = $1`,
    [runId, status, errorMessage ?? null],
  );
}
