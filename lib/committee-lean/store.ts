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
       -- Reclaim the row as human on override, so it LOCKS out the agent
       -- (the agent upsert only touches rows whose source is still 'agent').
       source = 'researcher',
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

/**
 * Write an AGENT (Grok classifier) committee label — source-aware so it NEVER
 * overwrites a human label. On conflict it updates only when the existing row is
 * itself agent-sourced; a `researcher`/`import` (human) row wins and is left
 * untouched (the `DO UPDATE ... WHERE` yields zero rows → skipped_human). A
 * human can always override + lock a committee via upsertCommitteeLeanLabel.
 */
export async function upsertAgentCommitteeLabel(
  client: PoolClient,
  params: {
    user_id: string;
    committee_name: string;
    lean: LeanLabel;
    confidence: number;
    notes?: string | null;
  },
): Promise<{ applied: boolean; skipped_human: boolean; row: CommitteeLeanLabelRow | null }> {
  const norm = committeeNameNorm(params.committee_name);
  const res = await client.query<CommitteeLeanLabelRow>(
    `INSERT INTO committee_lean_labels
       (user_id, committee_name_norm, committee_name, lean, confidence, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'agent')
     ON CONFLICT (user_id, committee_name_norm)
     DO UPDATE SET
       committee_name = EXCLUDED.committee_name,
       lean = EXCLUDED.lean,
       confidence = EXCLUDED.confidence,
       notes = EXCLUDED.notes,
       updated_at = NOW()
       WHERE committee_lean_labels.source = 'agent'
     RETURNING id, committee_name_norm, committee_name, lean, confidence, notes, source, updated_at::text`,
    [
      params.user_id,
      norm,
      params.committee_name.trim(),
      params.lean,
      params.confidence,
      params.notes?.trim() || null,
    ],
  );
  // No returned row means a human label already held the slot and the guarded
  // UPDATE did nothing (the INSERT lost the conflict). That's a deliberate skip.
  if (res.rows[0]) return { applied: true, skipped_human: false, row: res.rows[0] };
  return { applied: false, skipped_human: true, row: null };
}

/**
 * Remove a committee label entirely (source-agnostic — clears agent or human).
 * The caller should re-fuse the affected voters AFTER deleting so the rebuilt
 * evidence reads the labels without this one (reverting voters to their
 * pattern-lean, or Undetermined). See the DELETE route.
 */
export async function deleteCommitteeLeanLabel(
  client: PoolClient,
  params: { user_id: string; committee_name: string },
): Promise<{ deleted: boolean; committee_name_norm: string }> {
  const norm = committeeNameNorm(params.committee_name);
  const res = await client.query(
    `DELETE FROM committee_lean_labels
     WHERE user_id = $1 AND committee_name_norm = $2`,
    [params.user_id, norm],
  );
  return { deleted: (res.rowCount ?? 0) > 0, committee_name_norm: norm };
}