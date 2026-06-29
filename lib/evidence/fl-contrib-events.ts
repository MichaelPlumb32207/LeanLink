import { inferLeanFromFlContributions } from '@/lib/fl-contrib/donation-lean';
import type { FlContribIdentityResult } from '@/lib/fl-contrib/identity-match';
import type { FlContributionHit } from '@/lib/fl-contrib/types';
import type { EvidenceEventInput } from '@/lib/evidence/types';

export function buildFlContribEvidenceEvent(params: {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  identity: FlContribIdentityResult;
  hits: FlContributionHit[];
  match_layer: 1 | 2;
  snapshot_label: string;
  entity_name?: string;
}): EvidenceEventInput {
  const lean =
    params.identity.probable_same_person && params.hits.length > 0
      ? inferLeanFromFlContributions(params.hits, {
          layer: params.match_layer,
          entity_name: params.entity_name,
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
    },
    cost_usd: 0,
    dedupe_key: `fl_contrib_l${params.match_layer}`,
  };
}