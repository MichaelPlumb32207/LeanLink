import { appendEvidenceEvent } from '@/lib/evidence/ledger';
import { buildHouseholdEvidenceEvent } from '@/lib/evidence/household-events';
import { buildAnchorProfile } from '@/lib/anchor/profile';
import { loadUploadHouseholdIndex, householdForVoterRecord } from '@/lib/anchor/upload-index';
import type { PoolClient } from 'pg';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export async function syncAnchorProfilesToLedger(
  client: PoolClient,
  uploadId: string,
  userId: string,
): Promise<{ written: number; skipped: number }> {
  const index = await loadUploadHouseholdIndex(client, uploadId, userId);
  const { rows } = await client.query<{
    id: string;
    raw_data: ParsedFlVoterRecord;
  }>(
    `SELECT id, raw_data FROM voter_records WHERE upload_id = $1 AND user_id = $2 ORDER BY row_index`,
    [uploadId, userId],
  );

  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    const members = householdForVoterRecord(index, row.id, row.raw_data);
    const profile = buildAnchorProfile(row.raw_data, members, row.id);
    const event = buildHouseholdEvidenceEvent({
      upload_id: uploadId,
      voter_record_id: row.id,
      user_id: userId,
      voter: row.raw_data,
      profile,
    });
    if (!event) {
      skipped += 1;
      continue;
    }
    await appendEvidenceEvent(client, event);
    written += 1;
  }

  return { written, skipped };
}