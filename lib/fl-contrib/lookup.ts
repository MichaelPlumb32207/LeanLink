import { contributorNameNorm } from '@/lib/fl-contrib/parse-tsv';
import { entityNameKey, normalizeNameKey } from '@/lib/reference-data/normalize';
import type { FlContributionHit } from '@/lib/fl-contrib/types';
import type { PoolClient } from 'pg';

export async function getActiveFlContribSnapshotId(
  client: PoolClient,
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM reference_snapshots
     WHERE source = 'fl_contrib'
     ORDER BY imported_at DESC
     LIMIT 1`,
  );
  return res.rows[0]?.id ?? null;
}

export async function lookupFlContributionsByContributor(params: {
  client: PoolClient;
  snapshotId: string;
  contributorName: string;
  city?: string;
  zip5?: string;
  limit?: number;
}): Promise<FlContributionHit[]> {
  const norm = contributorNameNorm(params.contributorName);
  const limit = params.limit ?? 25;

  const res = await params.client.query<FlContributionHit>(
    `SELECT id, snapshot_id, contributor_name, address, city, state, zip5,
            amount, contribution_date, committee_name, contribution_type, occupation
     FROM fl_contributions
     WHERE snapshot_id = $1
       AND contributor_name_norm = $2
     ORDER BY contribution_date DESC NULLS LAST
     LIMIT $3`,
    [params.snapshotId, norm, limit],
  );

  if (res.rows.length > 0) return res.rows;

  const fuzzy = await params.client.query<FlContributionHit>(
    `SELECT id, snapshot_id, contributor_name, address, city, state, zip5,
            amount, contribution_date, committee_name, contribution_type, occupation
     FROM fl_contributions
     WHERE snapshot_id = $1
       AND contributor_name_norm LIKE $2
     ORDER BY contribution_date DESC NULLS LAST
     LIMIT $3`,
    [params.snapshotId, `${norm}%`, limit],
  );
  return fuzzy.rows;
}

export async function lookupFlContributionsByEntityName(params: {
  client: PoolClient;
  snapshotId: string;
  entityName: string;
  limit?: number;
}): Promise<FlContributionHit[]> {
  const norm = entityNameKey(params.entityName);
  const limit = params.limit ?? 15;

  const res = await params.client.query<FlContributionHit>(
    `SELECT id, snapshot_id, contributor_name, address, city, state, zip5,
            amount, contribution_date, committee_name, contribution_type, occupation
     FROM fl_contributions
     WHERE snapshot_id = $1
       AND (
         contributor_name_norm = $2
         OR contributor_name_norm LIKE $3
       )
     ORDER BY contribution_date DESC NULLS LAST
     LIMIT $4`,
    [params.snapshotId, normalizeNameKey(params.entityName), `%${norm}%`, limit],
  );
  return res.rows;
}