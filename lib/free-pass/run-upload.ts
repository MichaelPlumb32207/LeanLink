import { getActiveFlContribSnapshotId } from '@/lib/fl-contrib/lookup';
import { runFreePassForVoter, type FreePassVoterResult } from '@/lib/free-pass/run-voter';
import { getActiveSunbizSnapshotId } from '@/lib/sunbiz/lookup';
import { loadUploadHouseholdIndex } from '@/lib/anchor/upload-index';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export interface FreePassUploadResult {
  processed: number;
  events_total: number;
  fl_contrib_snapshot: string | null;
  sunbiz_snapshot: string | null;
  missing_indexes: string[];
  rows: FreePassVoterResult[];
}

export async function runFreePassForUpload(
  client: PoolClient,
  uploadId: string,
  userId: string,
): Promise<FreePassUploadResult> {
  const flSnapshotId = await getActiveFlContribSnapshotId(client);
  const sunbizSnapshotId = await getActiveSunbizSnapshotId(client);
  const missing_indexes: string[] = [];
  if (!flSnapshotId) missing_indexes.push('fl_contrib');
  if (!sunbizSnapshotId) missing_indexes.push('sunbiz_cor');

  const householdIndex = await loadUploadHouseholdIndex(client, uploadId, userId);

  const { rows: voters } = await client.query<{
    id: string;
    raw_data: ParsedFlVoterRecord;
  }>(
    `SELECT id, raw_data FROM voter_records
     WHERE upload_id = $1 AND user_id = $2
     ORDER BY row_index`,
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
      sunbizSnapshotId,
      householdIndex,
    });
    results.push(result);
    events_total += result.events_written;
  }

  return {
    processed: voters.length,
    events_total,
    fl_contrib_snapshot: flSnapshotId,
    sunbiz_snapshot: sunbizSnapshotId,
    missing_indexes,
    rows: results,
  };
}