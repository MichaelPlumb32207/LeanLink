import { loadResearcherCommitteeLabels } from '@/lib/committee-lean/store';
import type { FreePassSteps } from '@/lib/free-pass/steps';
import { FREE_PASS_ALL } from '@/lib/free-pass/steps';
import { getActiveFlContribSnapshotId } from '@/lib/fl-contrib/lookup';
import { runFreePassForVoter, type FreePassVoterResult } from '@/lib/free-pass/run-voter';
import { getActiveSunbizSnapshotIds } from '@/lib/sunbiz/lookup';
import { loadUploadHouseholdIndex } from '@/lib/anchor/upload-index';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export interface FreePassUploadResult {
  processed: number;
  events_total: number;
  fl_contrib_snapshot: string | null;
  sunbiz_snapshots: string[];
  missing_indexes: string[];
  rows: FreePassVoterResult[];
}

export async function runFreePassForUpload(
  client: PoolClient,
  uploadId: string,
  userId: string,
  steps: FreePassSteps = FREE_PASS_ALL,
): Promise<FreePassUploadResult> {
  const flSnapshotId = await getActiveFlContribSnapshotId(client);
  const sunbizSnapshotIds = await getActiveSunbizSnapshotIds(client);
  const missing_indexes: string[] = [];
  if (!flSnapshotId) missing_indexes.push('fl_contrib');
  if (sunbizSnapshotIds.length === 0) missing_indexes.push('sunbiz_cor');

  const householdIndex = await loadUploadHouseholdIndex(client, uploadId, userId);
  const researcherLabels = await loadResearcherCommitteeLabels(client, userId);

  const { rows: voters } = await client.query<{
    id: string;
    raw_data: ParsedFlVoterRecord;
  }>(
    `SELECT vr.id, vr.raw_data FROM voter_records vr
     WHERE vr.upload_id = $1 AND vr.user_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM voter_lean_fusion vlf
         WHERE vlf.voter_record_id = vr.id AND vlf.settled_tier IS NOT NULL
       )
     ORDER BY vr.row_index`,
    [uploadId, userId],
  );

  const results: FreePassVoterResult[] = [];
  let events_total = 0;

  for (const voter of voters) {
    const result = await runFreePassForVoter(client, {
      upload_id: uploadId,
      voter_record_id: voter.id,
      user_id: userId,
      voter: voter.raw_data,
      flSnapshotId,
      sunbizSnapshotIds,
      householdIndex,
      researcherLabels,
      steps,
    });
    results.push(result);
    events_total += result.events_written;
  }

  return {
    processed: voters.length,
    events_total,
    fl_contrib_snapshot: flSnapshotId,
    sunbiz_snapshots: sunbizSnapshotIds,
    missing_indexes,
    rows: results,
  };
}