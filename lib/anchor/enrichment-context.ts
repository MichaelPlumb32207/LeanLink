import { buildEnrichmentBundle } from '@/lib/enrichment/build-bundle';
import { buildAnchorProfile } from '@/lib/anchor/profile';
import {
  householdForVoterRecord,
  loadUploadHouseholdIndex,
  type UploadHouseholdIndex,
} from '@/lib/anchor/upload-index';
import type { EnrichmentBundle } from '@/lib/enrichment/types';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

export async function ensureUploadHouseholdIndex(
  client: PoolClient,
  uploadId: string,
  userId: string,
  existing?: UploadHouseholdIndex,
): Promise<UploadHouseholdIndex> {
  return existing ?? loadUploadHouseholdIndex(client, uploadId, userId);
}

export function buildBundleWithAnchorProfile(
  record: ParsedFlVoterRecord,
  historySummary: VoterHistorySummary | null | undefined,
  ballotFavors: BallotFavors,
  params: {
    voterRecordId: string;
    householdIndex: UploadHouseholdIndex;
  },
): EnrichmentBundle {
  const members = householdForVoterRecord(
    params.householdIndex,
    params.voterRecordId,
    record,
  );
  const anchor_profile = buildAnchorProfile(record, members, params.voterRecordId);
  return buildEnrichmentBundle(record, historySummary, ballotFavors, anchor_profile);
}