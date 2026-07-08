import { buildFlContribEvidenceEvent } from '@/lib/evidence/fl-contrib-events';
import { appendEvidenceEvent, fuseAndPersistVoter } from '@/lib/evidence/ledger';
import { scoreFlContributionsAgainstVoter } from '@/lib/fl-contrib/identity-match';
import {
  getActiveFlContribSnapshotId,
  lookupFlContributionsByContributor,
  lookupFlContributionsByEntityName,
} from '@/lib/fl-contrib/lookup';
import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import { loadResearcherCommitteeLabels } from '@/lib/committee-lean/store';
import { loadLeanPatterns } from '@/lib/lean-patterns/registry';
import { CLAIM_ELIGIBLE_PREDICATE } from '@/lib/evidence/arm-runs';
import { buildNameSearchVariants, fecQueryNames } from '@/lib/anchor/name-variants';
import { parseEmailInsights } from '@/lib/enrichment/email-insights';
import type { FlContributionHit } from '@/lib/fl-contrib/types';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { PoolClient } from 'pg';

async function snapshotLabel(client: PoolClient, snapshotId: string): Promise<string> {
  const res = await client.query<{ label: string }>(
    `SELECT label FROM reference_snapshots WHERE id = $1`,
    [snapshotId],
  );
  return res.rows[0]?.label ?? snapshotId;
}

export async function refusionFlContribForCommittee(
  client: PoolClient,
  params: {
    user_id: string;
    committee_name: string;
    upload_id?: string | null;
  },
): Promise<{ voters_refused: number }> {
  const norm = committeeNameNorm(params.committee_name);
  const labels = await loadResearcherCommitteeLabels(client, params.user_id);
  const leanPatterns = await loadLeanPatterns(client, params.user_id);
  const flSnapshotId = await getActiveFlContribSnapshotId(client);
  if (!flSnapshotId) return { voters_refused: 0 };

  const flLabel = await snapshotLabel(client, flSnapshotId);
  const queryParams: string[] = [params.user_id];
  let uploadFilter = '';
  if (params.upload_id) {
    queryParams.push(params.upload_id);
    uploadFilter = ` AND ee.upload_id = $${queryParams.length}`;
  }

  queryParams.push(norm);
  const normParam = `$${queryParams.length}`;

  const voters = await client.query<{
    voter_record_id: string;
    upload_id: string;
    raw_data: ParsedFlVoterRecord;
    match_layer: number;
    entity_name: string | null;
  }>(
    `SELECT DISTINCT ON (ee.voter_record_id, ee.payload->>'match_layer')
            ee.voter_record_id,
            ee.upload_id,
            vr.raw_data,
            (ee.payload->>'match_layer')::int AS match_layer,
            ee.payload->>'entity_name' AS entity_name
     FROM evidence_events ee
     JOIN voter_records vr ON vr.id = ee.voter_record_id
     WHERE ee.user_id = $1 AND ee.arm = 'fl_contrib'${uploadFilter}
       AND COALESCE(ee.payload->'committee_norms', '[]'::jsonb) @> to_jsonb(ARRAY[${normParam}]::text[])
     ORDER BY ee.voter_record_id, ee.payload->>'match_layer', ee.created_at DESC`,
    queryParams,
  );

  let count = 0;
  for (const row of voters.rows) {
    const match_layer = row.match_layer === 2 ? 2 : 1;
    let hits: FlContributionHit[] = [];

    if (match_layer === 1) {
      const emailInsights = parseEmailInsights(row.raw_data.email, row.raw_data.name.full);
      const names = fecQueryNames(buildNameSearchVariants(row.raw_data, emailInsights), 3);
      const layer1Hits = [];
      for (const name of names) {
        const found = await lookupFlContributionsByContributor({
          client,
          snapshotId: flSnapshotId,
          contributorName: name,
          city: row.raw_data.residence.city,
          zip5: row.raw_data.residence.zip,
        });
        layer1Hits.push(...found);
      }
      hits = [...new Map(layer1Hits.map((h) => [h.id, h])).values()];
    } else if (row.entity_name) {
      hits = await lookupFlContributionsByEntityName({
        client,
        snapshotId: flSnapshotId,
        entityName: row.entity_name,
      });
    }

    const identity = scoreFlContributionsAgainstVoter({
      voter: row.raw_data,
      hits,
      match_layer,
    });

    await appendEvidenceEvent(
      client,
      buildFlContribEvidenceEvent({
        upload_id: row.upload_id,
        voter_record_id: row.voter_record_id,
        user_id: params.user_id,
        identity,
        hits,
        match_layer,
        snapshot_label: flLabel,
        entity_name: row.entity_name ?? undefined,
        researcher_labels: labels,
        lean_patterns: leanPatterns,
      }),
    );

    await fuseAndPersistVoter(client, row.voter_record_id, row.upload_id, params.user_id);
    count += 1;
  }

  return { voters_refused: count };
}

/**
 * Re-fuse every voter behind a labeled committee whose fusion is still
 * Undetermined and eligible (the "Re-fuse now" bulk action). Selects the
 * labeled committees that actually have pending voters, then loops the vetted
 * per-committee re-fuse over each. Bounded to committees with pending work.
 */
export async function refusionAllPendingForUpload(
  client: PoolClient,
  params: { user_id: string; upload_id?: string | null },
): Promise<{ voters_refused: number; committees_processed: number }> {
  const qp: string[] = [params.user_id];
  let uploadFilter = '';
  if (params.upload_id) {
    qp.push(params.upload_id);
    uploadFilter = ` AND ee.upload_id = $${qp.length}`;
  }
  const { rows } = await client.query<{ committee_name: string }>(
    `SELECT DISTINCT cl.committee_name
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
       AND ${CLAIM_ELIGIBLE_PREDICATE}`,
    qp,
  );

  let voters_refused = 0;
  for (const r of rows) {
    const out = await refusionFlContribForCommittee(client, {
      user_id: params.user_id,
      committee_name: r.committee_name,
      upload_id: params.upload_id ?? null,
    });
    voters_refused += out.voters_refused;
  }
  return { voters_refused, committees_processed: rows.length };
}