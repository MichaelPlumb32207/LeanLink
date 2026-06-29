import type { EvidenceEventInput } from '@/lib/evidence/types';
import type { GrokPipelineResult } from '@/lib/enrichment/types';
import type { EnrichmentMode } from '@/lib/enrichment/modes';

export function buildOsintEvidenceEvent(params: {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  mode: EnrichmentMode;
  result: GrokPipelineResult;
  cost_usd?: number | null;
}): EvidenceEventInput {
  const { result, mode } = params;
  const enrichment = result.enrichment;
  const identityBand =
    enrichment.identity_resolution_status === 'probable'
      ? 'probable'
      : enrichment.identity_resolution_status === 'ambiguous'
        ? 'ambiguous'
        : 'none';

  const leanOk =
    enrichment.lean_signals_found &&
    result.lean !== 'Undetermined' &&
    enrichment.identity_resolution_status === 'probable';

  return {
    upload_id: params.upload_id,
    voter_record_id: params.voter_record_id,
    user_id: params.user_id,
    arm: 'osint',
    source: mode,
    identity_band: identityBand,
    identity_score: enrichment.identity_best_match_score,
    probable_same_person: enrichment.identity_resolution_status === 'probable',
    lean_signal: leanOk ? result.lean : 'Undetermined',
    lean_confidence: leanOk ? result.confidence : null,
    evidence: result.evidence,
    urls: enrichment.citations,
    payload: {
      dedupe_key: mode,
      identity_resolution_status: enrichment.identity_resolution_status,
      lean_signals_found: enrichment.lean_signals_found,
    },
    cost_usd: params.cost_usd ?? null,
    dedupe_key: mode,
  };
}