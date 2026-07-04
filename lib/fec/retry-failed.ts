import type { Pool } from 'pg';
import { FEC_REQUEST_INTERVAL_MS, sleep } from '@/lib/fec/sweep-config';
import {
  processFecSweepRow,
  refreshFecSweepJobCounts,
  type FecSweepClaimedRow,
} from '@/lib/fec/sweep-runner';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export interface FecRetryResult {
  scanned: number;
  attempted: number;
  recovered: number;
}

interface FailedRow {
  id: string;
  row_index: number;
  voter_hash: string;
  upload_id: string;
  sweep_job_id: string;
  user_id: string;
  raw_data: ParsedFlVoterRecord;
}

/**
 * Re-attempt FEC lookups that previously died on a transient API error, so a
 * flaky-then-recovered FEC no longer leaves a real donor recorded as a non-donor.
 *
 * Runs as a system job (uses the pool directly). Each row is processed in its
 * own transaction under that row's user context (`app.current_user`) so RLS,
 * fusion, settlement, and billing all behave exactly as in a normal sweep — a
 * recovered hit flows straight into the evidence ledger and settles/bills.
 *
 * Bounded three ways so it can't hammer FEC or loop forever:
 *  - only rows with api_error set and retry_attempts < maxAttempts
 *  - only rows not attempted within the last `minMinutesBetween`
 *  - a per-invocation row limit + wall-clock budget, throttled between calls
 */
export async function retryFailedFecRows(
  pool: Pool,
  opts: {
    limit?: number;
    maxAttempts?: number;
    minMinutesBetween?: number;
    budgetMs?: number;
  } = {},
): Promise<FecRetryResult> {
  const limit = opts.limit ?? 8;
  const maxAttempts = opts.maxAttempts ?? 8;
  const minMinutesBetween = opts.minMinutesBetween ?? 10;
  const deadline = Date.now() + (opts.budgetMs ?? 50_000);

  const scan = await pool.connect();
  let rows: FailedRow[];
  try {
    const res = await scan.query<FailedRow>(
      `SELECT flr.voter_record_id AS id, flr.row_index, flr.voter_hash, flr.upload_id,
              flr.sweep_job_id, flr.user_id, vr.raw_data
       FROM fec_lookup_results flr
       JOIN voter_records vr ON vr.id = flr.voter_record_id
       WHERE flr.api_error IS NOT NULL
         AND flr.retry_attempts < $1
         AND (flr.last_attempt_at IS NULL
              OR flr.last_attempt_at < NOW() - make_interval(mins => $2))
       ORDER BY flr.last_attempt_at ASC NULLS FIRST
       LIMIT $3`,
      [maxAttempts, minMinutesBetween, limit],
    );
    rows = res.rows;
  } finally {
    scan.release();
  }

  let attempted = 0;
  let recovered = 0;
  const touchedJobs = new Map<string, string>(); // sweep_job_id → user_id

  for (const row of rows) {
    if (Date.now() > deadline) break;

    // Count the attempt in its OWN committed transaction first, so a slow row
    // that gets killed by the function time limit still advances the cap and
    // can't retry forever without progress.
    const counter = await pool.connect();
    try {
      await counter.query(
        `UPDATE fec_lookup_results
         SET retry_attempts = retry_attempts + 1, last_attempt_at = NOW()
         WHERE sweep_job_id = $1 AND voter_record_id = $2`,
        [row.sweep_job_id, row.id],
      );
    } finally {
      counter.release();
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [row.user_id]);

      const claimed: FecSweepClaimedRow = {
        id: row.id,
        row_index: row.row_index,
        voter_hash: row.voter_hash,
        raw_data: row.raw_data,
        upload_id: row.upload_id,
      };
      // Re-runs the lookup, re-scores, upserts the result (clearing api_error on
      // success), appends the FEC evidence event, and re-fuses (settle + bill).
      await processFecSweepRow(client, row.sweep_job_id, row.user_id, claimed);

      const after = await client.query<{ api_error: string | null }>(
        `SELECT api_error FROM fec_lookup_results
         WHERE sweep_job_id = $1 AND voter_record_id = $2`,
        [row.sweep_job_id, row.id],
      );
      await client.query('COMMIT');

      attempted += 1;
      if (after.rows[0]?.api_error == null) recovered += 1;
      touchedJobs.set(row.sweep_job_id, row.user_id);
    } catch {
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
    }

    await sleep(FEC_REQUEST_INTERVAL_MS);
  }

  // Refresh sweep-job counters so the dashboard reflects recoveries.
  for (const [jobId, userId] of touchedJobs) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
      await refreshFecSweepJobCounts(c, jobId);
      await c.query('COMMIT');
    } catch {
      await c.query('ROLLBACK').catch(() => {});
    } finally {
      c.release();
    }
  }

  return { scanned: rows.length, attempted, recovered };
}
