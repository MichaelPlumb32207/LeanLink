import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { buildFecSweepEvidenceEvent } from '@/lib/evidence/fec-events';
import { scoreFecLookupForVoter } from '@/lib/fec/score-lookup-result';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import type { FecContributionHit } from '@/lib/fec/contributor-lookup';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export async function syncFecSweepToEvidenceLedger(
  client: PoolClient,
  sweepJobId: string,
  uploadId: string,
  userId: string,
): Promise<{ synced: number }> {
  const patterns = await loadLeanPatterns(client, userId);
  const { rows } = await client.query<{
    id: string;
    voter_record_id: string;
    raw_data: ParsedFlVoterRecord;
    contributions: FecContributionHit[];
    match_level: 'strict' | 'state_only' | 'none';
    has_hits: boolean;
  }>(
    `SELECT flr.id, flr.voter_record_id, vr.raw_data, flr.contributions, flr.match_level, flr.has_hits
     FROM fec_lookup_results flr
     JOIN voter_records vr ON vr.id = flr.voter_record_id
     WHERE flr.sweep_job_id = $1`,
    [sweepJobId],
  );

  for (const row of rows) {
    const contributions = Array.isArray(row.contributions) ? row.contributions : [];
    const scored = scoreFecLookupForVoter({
      voter: row.raw_data,
      contributions,
      matchLevel: row.has_hits ? row.match_level : 'none',
      patterns,
    });

    await appendEvidenceEvent(
      client,
      buildFecSweepEvidenceEvent({
        upload_id: uploadId,
        voter_record_id: row.voter_record_id,
        user_id: userId,
        voter: row.raw_data,
        scored,
        match_level: row.match_level,
        has_hits: row.has_hits,
        sweep_job_id: sweepJobId,
      }),
    );

    await fuseAndPersistVoter(client, row.voter_record_id, uploadId, userId);
  }

  return { synced: rows.length };
}