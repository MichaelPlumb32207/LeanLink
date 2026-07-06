import type { FecContributionHit } from '@/lib/fec/contributor-lookup';
import { scoreFecLookupForVoter } from '@/lib/fec/score-lookup-result';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import type { LeanPatternSets } from '@/lib/lean-patterns/patterns';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export async function rescoreFecLookupRow(
  client: PoolClient,
  lookupResultId: string,
  voter: ParsedFlVoterRecord,
  contributions: FecContributionHit[],
  matchLevel: 'strict' | 'state_only' | 'none',
  patterns?: LeanPatternSets,
): Promise<void> {
  const has_hits = contributions.length > 0;
  const scored = scoreFecLookupForVoter({
    voter,
    contributions,
    matchLevel: has_hits ? matchLevel : 'none',
    patterns,
  });

  await client.query(
    `UPDATE fec_lookup_results
     SET identity_band = $2,
         identity_best_score = $3,
         probable_same_person = $4,
         identity_scored = $5,
         fec_lean = $6,
         fec_lean_confidence = $7
     WHERE id = $1`,
    [
      lookupResultId,
      scored.identity.identity_band,
      scored.identity.best_score,
      scored.identity.probable_same_person,
      JSON.stringify(scored.identity),
      scored.fec_lean,
      scored.fec_lean_confidence,
    ],
  );
}

export async function rescoreFecSweepJob(
  client: PoolClient,
  jobId: string,
): Promise<{ rescored: number }> {
  const { rows } = await client.query<{
    id: string;
    user_id: string;
    raw_data: ParsedFlVoterRecord;
    contributions: FecContributionHit[];
    match_level: 'strict' | 'state_only' | 'none';
  }>(
    `SELECT flr.id, flr.user_id, vr.raw_data, flr.contributions, flr.match_level
     FROM fec_lookup_results flr
     JOIN voter_records vr ON vr.id = flr.voter_record_id
     WHERE flr.sweep_job_id = $1`,
    [jobId],
  );

  const patterns = rows.length
    ? await loadLeanPatterns(client, rows[0].user_id)
    : undefined;

  for (const row of rows) {
    const contributions = Array.isArray(row.contributions) ? row.contributions : [];
    await rescoreFecLookupRow(
      client,
      row.id,
      row.raw_data,
      contributions,
      row.match_level,
      patterns,
    );
  }

  await client.query(
    `UPDATE fec_sweep_jobs j
     SET confirmed_hits_count = (
           SELECT COUNT(*) FROM fec_lookup_results flr
           WHERE flr.sweep_job_id = j.id AND flr.probable_same_person = TRUE
         )
     WHERE j.id = $1`,
    [jobId],
  );

  return { rescored: rows.length };
}