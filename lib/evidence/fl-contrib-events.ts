import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import { unresolvedCommitteeNames } from '@/lib/committee-lean/infer';
import type { ResearcherCommitteeLabel } from '@/lib/committee-lean/infer';
import { inferLeanFromFlContributions } from '@/lib/fl-contrib/donation-lean';
import type { FlContribIdentityResult } from '@/lib/fl-contrib/identity-match';
import type { FlContributionHit } from '@/lib/fl-contrib/types';
import type { LeanPatternSets } from '@/lib/lean-patterns/patterns';
import { SCORER_VERSION } from '@/lib/evidence/scorer-version';
import type { EvidenceEventInput } from '@/lib/evidence/types';

function shouldInferFlContribLean(
  identity: FlContribIdentityResult,
  match_layer: 1 | 2,
  hitCount: number,
): boolean {
  if (hitCount === 0) return false;
  if (identity.probable_same_person) return true;
  return match_layer === 2 && identity.identity_band === 'probable';
}

export function buildFlContribEvidenceEvent(params: {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  identity: FlContribIdentityResult;
  hits: FlContributionHit[];
  match_layer: 1 | 2;
  snapshot_label: string;
  entity_name?: string;
  researcher_labels?: Map<string, ResearcherCommitteeLabel>;
  lean_patterns?: LeanPatternSets;
}): EvidenceEventInput {
  const committees = [
    ...new Set(params.hits.map((h) => h.committee_name).filter(Boolean) as string[]),
  ];
  const unresolved = unresolvedCommitteeNames(
    committees,
    params.researcher_labels,
    params.lean_patterns,
  );

  const lean = shouldInferFlContribLean(params.identity, params.match_layer, params.hits.length)
    ? inferLeanFromFlContributions(params.hits, {
        layer: params.match_layer,
        entity_name: params.entity_name,
        researcher_labels: params.researcher_labels,
        patterns: params.lean_patterns,
      })
    : {
        lean: 'Undetermined' as const,
        confidence: 0,
        lean_signals_found: false,
        evidence: [] as string[],
      };

  const evidence: string[] = [];
  if (params.hits.length === 0) {
    evidence.push(`FL state contrib layer ${params.match_layer}: no indexed hits.`);
  } else {
    evidence.push(
      `FL state contrib layer ${params.match_layer}: ${params.hits.length} hit(s); identity ${params.identity.identity_band} (${Math.round(params.identity.identity_score * 100)}%).`,
    );
    if (params.entity_name) evidence.push(`Entity bridge: ${params.entity_name}`);
    evidence.push(...lean.evidence);
  }

  return {
    upload_id: params.upload_id,
    voter_record_id: params.voter_record_id,
    user_id: params.user_id,
    arm: 'fl_contrib',
    source: params.match_layer === 2 ? 'fl_contrib_entity' : 'fl_contrib_index',
    identity_band: params.identity.identity_band,
    identity_score: params.identity.identity_score,
    probable_same_person: params.identity.probable_same_person,
    lean_signal: lean.lean_signals_found ? lean.lean : 'Undetermined',
    lean_confidence: lean.lean_signals_found ? lean.confidence : null,
    evidence,
    urls: [],
    payload: {
      dedupe_key: `fl_contrib_l${params.match_layer}`,
      snapshot_label: params.snapshot_label,
      match_layer: params.match_layer,
      hit_count: params.hits.length,
      entity_name: params.entity_name ?? null,
      committees,
      committee_norms: committees.map((c) => committeeNameNorm(c)),
      unresolved_committees: unresolved,
      scorer_v: SCORER_VERSION,
    },
    cost_usd: 0,
    dedupe_key: `fl_contrib_l${params.match_layer}`,
  };
}