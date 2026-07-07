/**
 * Whole-upload FEC match against the local bulk index — the fast Tier 1 arm.
 *
 * Chunked by row_index so callers control transaction size: the CLI commits
 * every chunk (a crash loses at most one chunk), the API route runs one chunk
 * for small lists. Claim predicate matches every other arm: accepted → never;
 * settled → only if re-enrolled; otherwise unsettled only.
 */
import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildFecIndexEvidenceEvent } from '@/lib/evidence/fec-events';
import {
  getActiveFecIndivSnapshot,
  getActiveFecIndivSnapshotSet,
  lookupFecIndexForVoter,
  type FecIndexSnapshotSet,
} from '@/lib/fec/local-lookup';
import { scoreFecLookupForVoter } from '@/lib/fec/score-lookup-result';
import type { LeanPatternSets } from '@/lib/lean-patterns/patterns';
import type { ResearcherCommitteeLabel } from '@/lib/committee-lean/infer';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export { getActiveFecIndivSnapshot, getActiveFecIndivSnapshotSet };

export interface FecIndexChunkResult {
  processed: number;
  with_hits: number;
  confirmed_identity: number;
  leans: number;
  last_row_index: number | null;
  snapshots: FecIndexSnapshotSet;
}

export interface FecIndexVoterRow {
  id: string;
  row_index: number;
  raw_data: ParsedFlVoterRecord;
}

export interface FecIndexVoterResult {
  with_hit: boolean;
  confirmed: boolean;
  lean: boolean;
}

/** Claim the next chunk of unsettled voters, in row order. */
export async function claimFecIndexRows(
  client: PoolClient,
  params: { uploadId: string; userId: string; afterRowIndex: number; limit: number },
): Promise<FecIndexVoterRow[]> {
  const { rows } = await client.query<FecIndexVoterRow>(
    `SELECT vr.id, vr.row_index, vr.raw_data
     FROM voter_records vr
     WHERE vr.upload_id = $1 AND vr.user_id = $2
       AND vr.row_index > $3
       AND NOT EXISTS (
         SELECT 1 FROM voter_lean_fusion vlf
         WHERE vlf.voter_record_id = vr.id
           AND (vlf.review_status = 'accepted'
                OR (vlf.settled_tier IS NOT NULL
                    AND vlf.research_status IS DISTINCT FROM 're_enrolled'))
       )
     ORDER BY vr.row_index
     LIMIT $4`,
    [params.uploadId, params.userId, params.afterRowIndex, params.limit],
  );
  return rows;
}

/**
 * Lookup → score → evidence upsert → fuse for ONE voter. Everything it touches
 * is voter-scoped, so distinct voters are safe to process on parallel
 * connections (the CLI's --concurrency path).
 */
export async function processFecIndexVoter(
  client: PoolClient,
  params: {
    uploadId: string;
    userId: string;
    snapshots: FecIndexSnapshotSet;
    voter: FecIndexVoterRow;
    patterns?: LeanPatternSets;
    researcherLabels?: Map<string, ResearcherCommitteeLabel>;
  },
): Promise<FecIndexVoterResult> {
  const { voter } = params;
  const lookup = await lookupFecIndexForVoter(client, params.snapshots.ids, voter.raw_data);
  const has_hits = lookup.contributions.length > 0;

  const scored = scoreFecLookupForVoter({
    voter: voter.raw_data,
    contributions: lookup.contributions,
    matchLevel: lookup.match_level,
    patterns: params.patterns,
    researcherLabels: params.researcherLabels,
  });

  await appendEvidenceEvent(
    client,
    buildFecIndexEvidenceEvent({
      upload_id: params.uploadId,
      voter_record_id: voter.id,
      user_id: params.userId,
      voter: voter.raw_data,
      scored,
      has_hits,
      names_tried: lookup.names_tried,
      snapshot_label: params.snapshots.label,
    }),
  );
  await fuseAndPersistVoter(client, voter.id, params.uploadId, params.userId);

  return {
    with_hit: has_hits,
    confirmed: scored.identity.probable_same_person,
    lean: Boolean(scored.fec_lean && scored.fec_lean !== 'Undetermined'),
  };
}

export async function runFecIndexChunk(
  client: PoolClient,
  params: {
    uploadId: string;
    userId: string;
    snapshots: FecIndexSnapshotSet;
    afterRowIndex?: number;
    limit?: number;
    patterns?: LeanPatternSets;
    researcherLabels?: Map<string, ResearcherCommitteeLabel>;
  },
): Promise<FecIndexChunkResult> {
  const voters = await claimFecIndexRows(client, {
    uploadId: params.uploadId,
    userId: params.userId,
    afterRowIndex: params.afterRowIndex ?? -1,
    limit: params.limit ?? 500,
  });

  let with_hits = 0;
  let confirmed_identity = 0;
  let leans = 0;

  for (const voter of voters) {
    const result = await processFecIndexVoter(client, {
      uploadId: params.uploadId,
      userId: params.userId,
      snapshots: params.snapshots,
      voter,
      patterns: params.patterns,
      researcherLabels: params.researcherLabels,
    });
    if (result.with_hit) with_hits += 1;
    if (result.confirmed) confirmed_identity += 1;
    if (result.lean) leans += 1;
  }

  return {
    processed: voters.length,
    with_hits,
    confirmed_identity,
    leans,
    last_row_index: voters.length ? voters[voters.length - 1].row_index : null,
    snapshots: params.snapshots,
  };
}
