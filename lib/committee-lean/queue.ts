import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import { inferLeanFromCommitteeName } from '@/lib/committee-lean/infer';
import { loadResearcherCommitteeLabels } from '@/lib/committee-lean/store';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import { CLAIM_ELIGIBLE_PREDICATE } from '@/lib/evidence/arm-runs';
import type { PoolClient } from 'pg';

export interface UncertainCommitteeRow {
  committee_name: string;
  committee_name_norm: string;
  npa_voter_count: number;
  sample_voter_record_id: string | null;
  sample_row_index: number | null;
  labeled: boolean;
  lean: string | null;
  /** Provenance — null on the uncertain (unlabeled) rows. */
  source: string | null; // 'researcher' | 'import' | 'agent'
  confidence: number | null;
  notes: string | null;
  updated_at: string | null;
}

export async function listUncertainCommittees(
  client: PoolClient,
  userId: string,
  uploadId?: string | null,
): Promise<{ uncertain: UncertainCommitteeRow[]; labeled: UncertainCommitteeRow[] }> {
  const labels = await loadResearcherCommitteeLabels(client, userId);
  const leanPatterns = await loadLeanPatterns(client, userId);

  const labeledParams: string[] = [userId];
  let labeledUploadFilter = '';
  if (uploadId) {
    labeledParams.push(uploadId);
    labeledUploadFilter = ` AND ee.upload_id = $2`;
  }

  const labeledRows = await client.query<{
    committee_name: string;
    committee_name_norm: string;
    lean: string;
    source: string;
    confidence: number;
    notes: string | null;
    updated_at: string;
    npa_voter_count: string;
  }>(
    `SELECT cl.committee_name, cl.committee_name_norm, cl.lean,
            cl.source, cl.confidence, cl.notes, cl.updated_at::text AS updated_at,
            COUNT(DISTINCT ee.voter_record_id)::text AS npa_voter_count
     FROM committee_lean_labels cl
     LEFT JOIN evidence_events ee ON ee.user_id = cl.user_id
       AND ee.arm = 'fl_contrib'
       AND ee.payload->'committees' @> to_jsonb(ARRAY[cl.committee_name])
       ${labeledUploadFilter}
     WHERE cl.user_id = $1 AND cl.lean != 'Undetermined'
     GROUP BY cl.committee_name, cl.committee_name_norm, cl.lean,
              cl.source, cl.confidence, cl.notes, cl.updated_at
     ORDER BY cl.source ASC, COUNT(DISTINCT ee.voter_record_id) DESC, cl.committee_name`,
    labeledParams,
  );

  const eventParams: string[] = [userId];
  let uploadFilter = '';
  if (uploadId) {
    eventParams.push(uploadId);
    uploadFilter = ` AND ee.upload_id = $${eventParams.length}`;
  }

  const events = await client.query<{
    committees: string[];
    voter_record_id: string;
    row_index: number;
  }>(
    `SELECT ee.payload->'committees' AS committees,
            ee.voter_record_id,
            vr.row_index
     FROM evidence_events ee
     JOIN voter_records vr ON vr.id = ee.voter_record_id
     WHERE ee.user_id = $1 AND ee.arm = 'fl_contrib'${uploadFilter}
       AND jsonb_array_length(COALESCE(ee.payload->'committees', '[]'::jsonb)) > 0`,
    eventParams,
  );

  const counts = new Map<
    string,
    { name: string; voters: Set<string>; sample_voter_record_id: string; sample_row_index: number }
  >();

  for (const row of events.rows) {
    const committees = Array.isArray(row.committees) ? row.committees : [];
    for (const name of committees) {
      if (!name?.trim()) continue;
      const norm = committeeNameNorm(name);
      if (labels.has(norm)) continue;
      if (inferLeanFromCommitteeName(name, labels, leanPatterns)) continue;

      const existing = counts.get(norm);
      if (existing) {
        existing.voters.add(row.voter_record_id);
      } else {
        counts.set(norm, {
          name,
          voters: new Set([row.voter_record_id]),
          sample_voter_record_id: row.voter_record_id,
          sample_row_index: row.row_index,
        });
      }
    }
  }

  const uncertain = [...counts.entries()]
    .map(([committee_name_norm, v]) => ({
      committee_name: v.name,
      committee_name_norm,
      npa_voter_count: v.voters.size,
      sample_voter_record_id: v.sample_voter_record_id,
      sample_row_index: v.sample_row_index,
      labeled: false,
      lean: null,
      source: null,
      confidence: null,
      notes: null,
      updated_at: null,
    }))
    .sort(
      (a, b) =>
        b.npa_voter_count - a.npa_voter_count || a.committee_name.localeCompare(b.committee_name),
    );

  const labeled = labeledRows.rows.map((r) => ({
    committee_name: r.committee_name,
    committee_name_norm: r.committee_name_norm,
    npa_voter_count: Number(r.npa_voter_count) || 0,
    sample_voter_record_id: null,
    sample_row_index: null,
    labeled: true,
    lean: r.lean,
    source: r.source,
    confidence: r.confidence == null ? null : Number(r.confidence),
    notes: r.notes,
    updated_at: r.updated_at,
  }));

  return { uncertain, labeled };
}

export interface PendingRefusionSummary {
  voters_pending: number;
  committees_pending: number;
}

/**
 * Voters behind a LABELED committee whose fusion lean is still Undetermined and
 * who are still eligible — i.e. a committee label exists but the voter hasn't
 * been re-fused to apply it. Manual labeling re-fuses synchronously, so this is
 * normally ~0; it grows when labels are written out-of-band (the classifier CLI
 * before its FL re-fuse step). Powers the "Re-fuse now" action. Matches on
 * `committee_norms` to mirror `refusionFlContribForCommittee`.
 */
export async function countPendingRefusion(
  client: PoolClient,
  userId: string,
  uploadId?: string | null,
): Promise<PendingRefusionSummary> {
  const params: string[] = [userId];
  let uploadFilter = '';
  if (uploadId) {
    params.push(uploadId);
    uploadFilter = ` AND ee.upload_id = $${params.length}`;
  }
  const res = await client.query<{ voters_pending: string; committees_pending: string }>(
    `WITH pending AS (
       SELECT DISTINCT ee.voter_record_id, cl.committee_name_norm
       FROM committee_lean_labels cl
       JOIN evidence_events ee
         ON ee.user_id = cl.user_id
        AND ee.arm = 'fl_contrib'
        AND COALESCE(ee.payload->'committee_norms', '[]'::jsonb)
            @> to_jsonb(ARRAY[cl.committee_name_norm]::text[])
        ${uploadFilter}
       JOIN voter_records vr ON vr.id = ee.voter_record_id
       JOIN voter_lean_fusion vlf ON vlf.voter_record_id = vr.id
       WHERE cl.user_id = $1
         AND cl.lean != 'Undetermined'
         AND vlf.lean = 'Undetermined'
         AND ${CLAIM_ELIGIBLE_PREDICATE}
     )
     SELECT COUNT(DISTINCT voter_record_id)::text AS voters_pending,
            COUNT(DISTINCT committee_name_norm)::text AS committees_pending
     FROM pending`,
    params,
  );
  return {
    voters_pending: Number(res.rows[0]?.voters_pending ?? 0),
    committees_pending: Number(res.rows[0]?.committees_pending ?? 0),
  };
}