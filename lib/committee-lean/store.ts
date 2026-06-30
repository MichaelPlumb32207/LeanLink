import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import type { ResearcherCommitteeLabel } from '@/lib/committee-lean/infer';
import type { LeanLabel } from '@/lib/enrichment/types';
import type { PoolClient } from 'pg';

export interface CommitteeLeanLabelRow {
  id: string;
  committee_name_norm: string;
  committee_name: string;
  lean: LeanLabel;
  confidence: number;
  notes: string | null;
  source: string;
  updated_at: string;
}

export async function loadResearcherCommitteeLabels(
  client: PoolClient,
  userId: string,
): Promise<Map<string, ResearcherCommitteeLabel>> {
  try {
    return await loadResearcherCommitteeLabelsInner(client, userId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('committee_lean_labels') && msg.includes('does not exist')) {
      return new Map();
    }
    throw error;
  }
}

async function loadResearcherCommitteeLabelsInner(
  client: PoolClient,
  userId: string,
): Promise<Map<string, ResearcherCommitteeLabel>> {
  const res = await client.query<CommitteeLeanLabelRow>(
    `SELECT committee_name_norm, committee_name, lean, confidence, notes
     FROM committee_lean_labels
     WHERE user_id = $1 AND lean != 'Undetermined'`,
    [userId],
  );
  const map = new Map<string, ResearcherCommitteeLabel>();
  for (const row of res.rows) {
    map.set(row.committee_name_norm, {
      committee_name_norm: row.committee_name_norm,
      lean: row.lean,
      confidence: row.confidence,
      notes: row.notes,
    });
  }
  return map;
}

export async function upsertCommitteeLeanLabel(
  client: PoolClient,
  params: {
    user_id: string;
    committee_name: string;
    lean: LeanLabel;
    confidence?: number;
    notes?: string | null;
  },
): Promise<CommitteeLeanLabelRow> {
  const norm = committeeNameNorm(params.committee_name);
  const res = await client.query<CommitteeLeanLabelRow>(
    `INSERT INTO committee_lean_labels
       (user_id, committee_name_norm, committee_name, lean, confidence, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'researcher')
     ON CONFLICT (user_id, committee_name_norm)
     DO UPDATE SET
       committee_name = EXCLUDED.committee_name,
       lean = EXCLUDED.lean,
       confidence = EXCLUDED.confidence,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING id, committee_name_norm, committee_name, lean, confidence, notes, source, updated_at::text`,
    [
      params.user_id,
      norm,
      params.committee_name.trim(),
      params.lean,
      params.confidence ?? 70,
      params.notes?.trim() || null,
    ],
  );
  return res.rows[0];
}