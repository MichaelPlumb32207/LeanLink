import { loadResearcherCommitteeLabels } from '@/lib/committee-lean/store';
import type { FreePassSteps } from '@/lib/free-pass/steps';
import { FREE_PASS_ALL } from '@/lib/free-pass/steps';
import { getActiveFlContribSnapshotId } from '@/lib/fl-contrib/lookup';
import { runFreePassForVoter, type FreePassVoterResult } from '@/lib/free-pass/run-voter';
import { getActiveSunbizSnapshotIds } from '@/lib/sunbiz/lookup';
import { loadUploadHouseholdIndex } from '@/lib/anchor/upload-index';
import { CLAIM_ELIGIBLE_PREDICATE } from '@/lib/evidence/arm-runs';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import type { LeanPatternSets } from '@/lib/lean-patterns/patterns';
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

/**
 * Everything a free-pass run loads once and reuses for every voter. At county
 * scale the household-index rebuild would dominate if loaded per chunk — load
 * it once, pass it to every chunk (plain in-memory data, read-only thereafter,
 * safe to share across parallel workers).
 */
export interface FreePassContext {
  flSnapshotId: string | null;
  sunbizSnapshotIds: string[];
  missing_indexes: string[];
  householdIndex: Awaited<ReturnType<typeof loadUploadHouseholdIndex>>;
  researcherLabels: Awaited<ReturnType<typeof loadResearcherCommitteeLabels>>;
  leanPatterns: LeanPatternSets;
  /** Loaded once here so per-voter processing never queries static labels. */
  flLabel?: string;
  sunbizQuarterLabel?: string;
}

export async function loadFreePassContext(
  client: PoolClient,
  uploadId: string,
  userId: string,
): Promise<FreePassContext> {
  const flSnapshotId = await getActiveFlContribSnapshotId(client);
  const sunbizSnapshotIds = await getActiveSunbizSnapshotIds(client);
  const missing_indexes: string[] = [];
  if (!flSnapshotId) missing_indexes.push('fl_contrib');
  if (sunbizSnapshotIds.length === 0) missing_indexes.push('sunbiz_cor');
  const householdIndex = await loadUploadHouseholdIndex(client, uploadId, userId);
  const researcherLabels = await loadResearcherCommitteeLabels(client, userId);
  const leanPatterns = await loadLeanPatterns(client, userId);

  const labelFor = async (snapshotId: string): Promise<string> => {
    const res = await client.query<{ label: string }>(
      `SELECT label FROM reference_snapshots WHERE id = $1`,
      [snapshotId],
    );
    return res.rows[0]?.label ?? snapshotId;
  };
  const flLabel = flSnapshotId ? await labelFor(flSnapshotId) : undefined;
  const sunbizQuarterLabel = sunbizSnapshotIds.length
    ? (await labelFor(sunbizSnapshotIds[0])).replace(/-cor\d+$/, '')
    : undefined;

  return {
    flSnapshotId,
    sunbizSnapshotIds,
    missing_indexes,
    householdIndex,
    researcherLabels,
    leanPatterns,
    flLabel,
    sunbizQuarterLabel,
  };
}

export interface FreePassVoterRow {
  id: string;
  row_index: number;
  raw_data: ParsedFlVoterRecord;
}

/** Claim the next chunk of unsettled voters, in row order. */
export async function claimFreePassRows(
  client: PoolClient,
  params: { uploadId: string; userId: string; afterRowIndex: number; limit: number },
): Promise<FreePassVoterRow[]> {
  const { rows } = await client.query<FreePassVoterRow>(
    `SELECT vr.id, vr.row_index, vr.raw_data FROM voter_records vr
     WHERE vr.upload_id = $1 AND vr.user_id = $2
       AND vr.row_index > $3
       AND ${CLAIM_ELIGIBLE_PREDICATE}
     ORDER BY vr.row_index
     LIMIT $4`,
    [params.uploadId, params.userId, params.afterRowIndex, params.limit],
  );
  return rows;
}

/** Run the free pass for one claimed voter (voter-scoped writes; parallel-safe). */
export async function runFreePassVoterWithContext(
  client: PoolClient,
  params: {
    uploadId: string;
    userId: string;
    context: FreePassContext;
    steps: FreePassSteps;
    voter: FreePassVoterRow;
  },
): Promise<FreePassVoterResult> {
  return runFreePassForVoter(client, {
    upload_id: params.uploadId,
    voter_record_id: params.voter.id,
    user_id: params.userId,
    voter: params.voter.raw_data,
    flSnapshotId: params.context.flSnapshotId,
    sunbizSnapshotIds: params.context.sunbizSnapshotIds,
    householdIndex: params.context.householdIndex,
    researcherLabels: params.context.researcherLabels,
    leanPatterns: params.context.leanPatterns,
    steps: params.steps,
    flLabel: params.context.flLabel,
    sunbizQuarterLabel: params.context.sunbizQuarterLabel,
  });
}

/**
 * Whole-upload free pass on one client — the small-list path (the API route
 * caps it at 5,000 voters; county scale goes through scripts/run-free-pass.ts,
 * which chunks, parallelizes, and reports progress via arm_runs).
 */
export async function runFreePassForUpload(
  client: PoolClient,
  uploadId: string,
  userId: string,
  steps: FreePassSteps = FREE_PASS_ALL,
): Promise<FreePassUploadResult> {
  const context = await loadFreePassContext(client, uploadId, userId);

  const results: FreePassVoterResult[] = [];
  let events_total = 0;
  let afterRowIndex = -1;

  for (;;) {
    const voters = await claimFreePassRows(client, {
      uploadId,
      userId,
      afterRowIndex,
      limit: 250,
    });
    if (voters.length === 0) break;
    for (const voter of voters) {
      const result = await runFreePassVoterWithContext(client, {
        uploadId,
        userId,
        context,
        steps,
        voter,
      });
      results.push(result);
      events_total += result.events_written;
    }
    afterRowIndex = voters[voters.length - 1].row_index;
  }

  return {
    processed: results.length,
    events_total,
    fl_contrib_snapshot: context.flSnapshotId,
    sunbiz_snapshots: context.sunbizSnapshotIds,
    missing_indexes: context.missing_indexes,
    rows: results,
  };
}
