/**
 * Shared FL-extract voter_records insert — one source of truth for the hash +
 * column set, used by both the upload route (whole file, one transaction) and
 * scripts/ingest-extract.ts (county scale, per-chunk commits).
 */
import type { PoolClient } from 'pg';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { VoterHistorySummary } from '@/lib/fl-voter-history';
import { hashVoterPii } from '@/lib/hash';

/** Rows per INSERT statement (6 params each — well under the pg limit). */
export const VOTER_INSERT_BATCH = 100;

/**
 * Insert a slice of parsed records as voter_records rows. `startIndex` is the
 * row_index of records[0] within the upload. Returns how many rows carried a
 * non-empty history summary.
 */
export async function insertVoterRecords(
  client: PoolClient,
  args: {
    uploadId: string;
    userEmail: string;
    records: ParsedFlVoterRecord[];
    startIndex: number;
    historyMap: Map<string, VoterHistorySummary>;
  },
): Promise<number> {
  const { uploadId, userEmail, records, startIndex, historyMap } = args;
  let withHistory = 0;

  for (let start = 0; start < records.length; start += VOTER_INSERT_BATCH) {
    const chunk = records.slice(start, start + VOTER_INSERT_BATCH);
    const values: unknown[] = [];
    const placeholders = chunk.map((record, offset) => {
      const i = startIndex + start + offset;
      const voterHash = hashVoterPii({
        voterId: record.voterId,
        name: record.name.full,
        address: record.residence.full,
      });
      const historySummary = historyMap.get(record.voterId) ?? null;
      if (historySummary && historySummary.total_events > 0) withHistory += 1;

      const base = values.length;
      values.push(
        uploadId,
        userEmail,
        i,
        JSON.stringify(record),
        voterHash,
        historySummary ? JSON.stringify(historySummary) : null,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, 'pending')`;
    });

    await client.query(
      `INSERT INTO voter_records
         (upload_id, user_id, row_index, raw_data, voter_hash, history_summary, status)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  return withHistory;
}
