import type { PoolClient } from 'pg';
import { residenceAddressKey, type HouseholdMember } from '@/lib/anchor/household';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export interface UploadHouseholdIndex {
  by_address: Map<string, HouseholdMember[]>;
  by_voter_record_id: Map<string, HouseholdMember[]>;
}

export async function loadUploadHouseholdIndex(
  client: PoolClient,
  uploadId: string,
  userId: string,
): Promise<UploadHouseholdIndex> {
  const { rows } = await client.query<{
    id: string;
    row_index: number;
    raw_data: ParsedFlVoterRecord;
  }>(
    `SELECT id, row_index, raw_data
     FROM voter_records
     WHERE upload_id = $1 AND user_id = $2
     ORDER BY row_index`,
    [uploadId, userId],
  );

  const by_address = new Map<string, HouseholdMember[]>();

  for (const row of rows) {
    const key = residenceAddressKey(row.raw_data);
    if (!key) continue;

    const member: HouseholdMember = {
      voter_record_id: row.id,
      row_index: row.row_index,
      voter_id: row.raw_data.voterId,
      name_full: row.raw_data.name.full,
      party: row.raw_data.party,
      relationship_hint: 'co_resident',
    };

    const list = by_address.get(key) ?? [];
    list.push(member);
    by_address.set(key, list);
  }

  const by_voter_record_id = new Map<string, HouseholdMember[]>();
  for (const row of rows) {
    const key = residenceAddressKey(row.raw_data);
    if (!key) {
      by_voter_record_id.set(row.id, []);
      continue;
    }
    by_voter_record_id.set(row.id, by_address.get(key) ?? []);
  }

  return { by_address, by_voter_record_id };
}

export function householdForVoterRecord(
  index: UploadHouseholdIndex,
  voterRecordId: string,
  record: ParsedFlVoterRecord,
): HouseholdMember[] {
  const fromMap = index.by_voter_record_id.get(voterRecordId);
  if (fromMap) return fromMap;

  const key = residenceAddressKey(record);
  if (!key) return [];
  return index.by_address.get(key) ?? [];
}