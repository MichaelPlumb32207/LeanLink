import {
  FEC_REQUEST_INTERVAL_MS,
  FEC_SWEEP_BATCH_SIZE,
  getFecSweepDeadlineMs,
  sleep,
} from '@/lib/fec/sweep-config';
import { lookupFecContributions } from '@/lib/fec/contributor-lookup';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export { getFecSweepDeadlineMs, FEC_SWEEP_BATCH_SIZE, FEC_REQUEST_INTERVAL_MS, sleep };

export interface FecSweepClaimedRow {
  id: string;
  row_index: number;
  voter_hash: string;
  raw_data: ParsedFlVoterRecord;
  upload_id: string;
}

/** Dispatch worker in the background — do not await from API routes (worker runs minutes per call). */
export async function triggerFecSweepWorker(jobId: string): Promise<void> {
  const baseUrl =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const url = `${baseUrl.replace(/\/$/, '')}/api/fec-sweep/${jobId}/worker`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.INTERNAL_JOB_SECRET}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      console.error('FEC sweep worker trigger HTTP error', jobId, response.status, body);
    }
  } catch (error) {
    console.error('FEC sweep worker trigger failed', jobId, error);
  }
}

export async function claimFecSweepRows(
  client: PoolClient,
  jobId: string,
  userId: string,
  uploadId: string,
  limit: number,
): Promise<FecSweepClaimedRow[]> {
  const { rows } = await client.query<FecSweepClaimedRow>(
    `SELECT vr.id, vr.row_index, vr.voter_hash, vr.raw_data, vr.upload_id
     FROM voter_records vr
     WHERE vr.upload_id = $1
       AND vr.user_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM fec_lookup_results flr
         WHERE flr.sweep_job_id = $3 AND flr.voter_record_id = vr.id
       )
     ORDER BY vr.row_index
     LIMIT $4`,
    [uploadId, userId, jobId, limit],
  );
  return rows;
}

async function lookupWithRelaxedFallback(record: ParsedFlVoterRecord): Promise<{
  lookup: Awaited<ReturnType<typeof lookupFecContributions>>;
  match_level: 'strict' | 'state_only' | 'none';
}> {
  const strict = await lookupFecContributions({
    name: record.name.full,
    city: record.residence.city,
    state: record.residence.state || 'FL',
    zip: record.residence.zip,
    matchLevel: 'strict',
  });

  if (strict.contributions.length > 0) {
    return { lookup: strict, match_level: 'strict' };
  }
  if (strict.error) {
    return { lookup: strict, match_level: 'none' };
  }

  const relaxed = await lookupFecContributions({
    name: record.name.full,
    state: record.residence.state || 'FL',
    matchLevel: 'state_only',
  });

  if (relaxed.contributions.length > 0) {
    return { lookup: relaxed, match_level: 'state_only' };
  }

  return { lookup: strict, match_level: 'none' };
}

export async function processFecSweepRow(
  client: PoolClient,
  jobId: string,
  userId: string,
  row: FecSweepClaimedRow,
): Promise<void> {
  const { lookup, match_level } = await lookupWithRelaxedFallback(row.raw_data);
  const has_hits = lookup.contributions.length > 0;

  await client.query(
    `INSERT INTO fec_lookup_results
       (sweep_job_id, voter_record_id, upload_id, user_id, row_index, voter_hash,
        contributor_name, result_count, has_hits, match_level, contributions, query, api_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (sweep_job_id, voter_record_id) DO UPDATE SET
       result_count = EXCLUDED.result_count,
       has_hits = EXCLUDED.has_hits,
       match_level = EXCLUDED.match_level,
       contributions = EXCLUDED.contributions,
       query = EXCLUDED.query,
       api_error = EXCLUDED.api_error`,
    [
      jobId,
      row.id,
      row.upload_id,
      userId,
      row.row_index,
      row.voter_hash,
      row.raw_data.name.full,
      lookup.result_count,
      has_hits,
      match_level,
      JSON.stringify(lookup.contributions.slice(0, 20)),
      JSON.stringify(lookup.query),
      lookup.error ?? null,
    ],
  );
}

export async function markFecSweepRowFailed(
  client: PoolClient,
  jobId: string,
  userId: string,
  row: FecSweepClaimedRow,
  message: string,
): Promise<void> {
  await client.query(
    `INSERT INTO fec_lookup_results
       (sweep_job_id, voter_record_id, upload_id, user_id, row_index, voter_hash,
        contributor_name, result_count, has_hits, match_level, contributions, api_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, FALSE, 'none', '[]'::jsonb, $8)
     ON CONFLICT (sweep_job_id, voter_record_id) DO UPDATE SET api_error = EXCLUDED.api_error`,
    [
      jobId,
      row.id,
      row.upload_id,
      userId,
      row.row_index,
      row.voter_hash,
      row.raw_data.name.full,
      message.slice(0, 500),
    ],
  );
}

export async function refreshFecSweepJobCounts(
  client: PoolClient,
  jobId: string,
): Promise<void> {
  await client.query(
    `UPDATE fec_sweep_jobs j
     SET processed_count = (
           SELECT COUNT(*) FROM fec_lookup_results flr WHERE flr.sweep_job_id = j.id
         ),
         failed_count = (
           SELECT COUNT(*) FROM fec_lookup_results flr
           WHERE flr.sweep_job_id = j.id AND flr.api_error IS NOT NULL
         ),
         hits_count = (
           SELECT COUNT(*) FROM fec_lookup_results flr
           WHERE flr.sweep_job_id = j.id AND flr.has_hits = TRUE
         ),
         last_heartbeat_at = NOW()
     WHERE j.id = $1`,
    [jobId],
  );
}

export async function fecSweepRemainingCount(
  client: PoolClient,
  jobId: string,
  uploadId: string,
  userId: string,
): Promise<number> {
  const res = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM voter_records vr
     WHERE vr.upload_id = $1 AND vr.user_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM fec_lookup_results flr
         WHERE flr.sweep_job_id = $3 AND flr.voter_record_id = vr.id
       )`,
    [uploadId, userId, jobId],
  );
  return Number(res.rows[0]?.count ?? 0);
}