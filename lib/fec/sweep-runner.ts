import {
  FEC_REQUEST_INTERVAL_MS,
  FEC_SWEEP_BATCH_SIZE,
  getFecSweepDeadlineMs,
  sleep,
} from '@/lib/fec/sweep-config';
import { lookupFecForVoter } from '@/lib/fec/lookup-voter';
import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildFecSweepEvidenceEvent } from '@/lib/evidence/fec-events';
import { scoreFecLookupForVoter } from '@/lib/fec/score-lookup-result';
import type { LeanPatternSets } from '@/lib/lean-patterns/patterns';
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
       AND NOT EXISTS (
         SELECT 1 FROM voter_lean_fusion vlf
         WHERE vlf.voter_record_id = vr.id
           AND (vlf.review_status = 'accepted'
                OR (vlf.settled_tier IS NOT NULL
                    AND vlf.research_status IS DISTINCT FROM 're_enrolled'))
       )
     ORDER BY vr.row_index
     LIMIT $4`,
    [uploadId, userId, jobId, limit],
  );
  return rows;
}

export async function processFecSweepRow(
  client: PoolClient,
  jobId: string,
  userId: string,
  row: FecSweepClaimedRow,
  patterns?: LeanPatternSets,
): Promise<void> {
  const fecLookup = await lookupFecForVoter(row.raw_data);
  const { lookup, match_level, contributions, names_tried, variant_used } = fecLookup;
  const has_hits = contributions.length > 0;
  const scored = scoreFecLookupForVoter({
    voter: row.raw_data,
    contributions,
    matchLevel: has_hits ? match_level : 'none',
    patterns,
  });

  await client.query(
    `INSERT INTO fec_lookup_results
       (sweep_job_id, voter_record_id, upload_id, user_id, row_index, voter_hash,
        contributor_name, result_count, has_hits, match_level, contributions, query, api_error,
        identity_band, identity_best_score, probable_same_person, identity_scored,
        fec_lean, fec_lean_confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19)
     ON CONFLICT (sweep_job_id, voter_record_id) DO UPDATE SET
       result_count = EXCLUDED.result_count,
       has_hits = EXCLUDED.has_hits,
       match_level = EXCLUDED.match_level,
       contributions = EXCLUDED.contributions,
       query = EXCLUDED.query,
       api_error = EXCLUDED.api_error,
       identity_band = EXCLUDED.identity_band,
       identity_best_score = EXCLUDED.identity_best_score,
       probable_same_person = EXCLUDED.probable_same_person,
       identity_scored = EXCLUDED.identity_scored,
       fec_lean = EXCLUDED.fec_lean,
       fec_lean_confidence = EXCLUDED.fec_lean_confidence`,
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
      JSON.stringify(contributions.slice(0, 20)),
      JSON.stringify({ ...lookup.query, names_tried, variant_used }),
      lookup.error ?? null,
      scored.identity.identity_band,
      scored.identity.best_score,
      scored.identity.probable_same_person,
      JSON.stringify(scored.identity),
      scored.fec_lean,
      scored.fec_lean_confidence,
    ],
  );

  await appendEvidenceEvent(
    client,
    buildFecSweepEvidenceEvent({
      upload_id: row.upload_id,
      voter_record_id: row.id,
      user_id: userId,
      voter: row.raw_data,
      scored,
      match_level: has_hits ? match_level : 'none',
      has_hits,
      sweep_job_id: jobId,
    }),
  );
  await fuseAndPersistVoter(client, row.id, row.upload_id, userId);
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
         confirmed_hits_count = (
           SELECT COUNT(*) FROM fec_lookup_results flr
           WHERE flr.sweep_job_id = j.id AND flr.probable_same_person = TRUE
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
       )
       AND NOT EXISTS (
         SELECT 1 FROM voter_lean_fusion vlf
         WHERE vlf.voter_record_id = vr.id
           AND (vlf.review_status = 'accepted'
                OR (vlf.settled_tier IS NOT NULL
                    AND vlf.research_status IS DISTINCT FROM 're_enrolled'))
       )`,
    [uploadId, userId, jobId],
  );
  return Number(res.rows[0]?.count ?? 0);
}