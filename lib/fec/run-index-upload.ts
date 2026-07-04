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
  lookupFecIndexForVoter,
  type FecIndexSnapshot,
} from '@/lib/fec/local-lookup';
import { scoreFecLookupForVoter } from '@/lib/fec/score-lookup-result';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export { getActiveFecIndivSnapshot };

export interface FecIndexChunkResult {
  processed: number;
  with_hits: number;
  confirmed_identity: number;
  leans: number;
  last_row_index: number | null;
  snapshot: FecIndexSnapshot;
}

export async function runFecIndexChunk(
  client: PoolClient,
  params: {
    uploadId: string;
    userId: string;
    snapshot: FecIndexSnapshot;
    afterRowIndex?: number;
    limit?: number;
  },
): Promise<FecIndexChunkResult> {
  const limit = params.limit ?? 500;
  const afterRowIndex = params.afterRowIndex ?? -1;

  const { rows: voters } = await client.query<{
    id: string;
    row_index: number;
    raw_data: ParsedFlVoterRecord;
  }>(
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
    [params.uploadId, params.userId, afterRowIndex, limit],
  );

  let with_hits = 0;
  let confirmed_identity = 0;
  let leans = 0;

  for (const voter of voters) {
    const lookup = await lookupFecIndexForVoter(client, params.snapshot.id, voter.raw_data);
    const has_hits = lookup.contributions.length > 0;
    if (has_hits) with_hits += 1;

    const scored = scoreFecLookupForVoter({
      voter: voter.raw_data,
      contributions: lookup.contributions,
      matchLevel: lookup.match_level,
    });
    if (scored.identity.probable_same_person) confirmed_identity += 1;
    if (scored.fec_lean && scored.fec_lean !== 'Undetermined') leans += 1;

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
        snapshot_label: params.snapshot.label,
      }),
    );
    await fuseAndPersistVoter(client, voter.id, params.uploadId, params.userId);
  }

  return {
    processed: voters.length,
    with_hits,
    confirmed_identity,
    leans,
    last_row_index: voters.length ? voters[voters.length - 1].row_index : null,
    snapshot: params.snapshot,
  };
}
