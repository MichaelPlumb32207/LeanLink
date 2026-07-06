import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import { inferLeanFromCommitteeName } from '@/lib/committee-lean/infer';
import { loadResearcherCommitteeLabels } from '@/lib/committee-lean/store';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import type { PoolClient } from 'pg';

export interface UncertainCommitteeRow {
  committee_name: string;
  committee_name_norm: string;
  npa_voter_count: number;
  sample_voter_record_id: string | null;
  sample_row_index: number | null;
  labeled: boolean;
  lean: string | null;
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
    npa_voter_count: string;
  }>(
    `SELECT cl.committee_name, cl.committee_name_norm, cl.lean,
            COUNT(DISTINCT ee.voter_record_id)::text AS npa_voter_count
     FROM committee_lean_labels cl
     LEFT JOIN evidence_events ee ON ee.user_id = cl.user_id
       AND ee.arm = 'fl_contrib'
       AND ee.payload->'committees' @> to_jsonb(ARRAY[cl.committee_name])
       ${labeledUploadFilter}
     WHERE cl.user_id = $1 AND cl.lean != 'Undetermined'
     GROUP BY cl.committee_name, cl.committee_name_norm, cl.lean
     ORDER BY COUNT(DISTINCT ee.voter_record_id) DESC, cl.committee_name`,
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
  }));

  return { uncertain, labeled };
}