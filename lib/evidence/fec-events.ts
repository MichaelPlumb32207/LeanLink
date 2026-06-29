import { buildAnchorProfile } from '@/lib/anchor/profile';
import type { EvidenceEventInput } from '@/lib/evidence/types';
import type { FecScoredLookupResult } from '@/lib/fec/score-lookup-result';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export function buildFecSweepEvidenceEvent(params: {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  voter: ParsedFlVoterRecord;
  scored: FecScoredLookupResult;
  match_level: string;
  has_hits: boolean;
  sweep_job_id: string;
}): EvidenceEventInput {
  const { scored, has_hits } = params;
  const anchorProfile = buildAnchorProfile(params.voter, []);
  const top = scored.identity.contributions[0];
  const urls =
    scored.identity.contributions
      .filter((c) => c.probable_same_person && c.contribution.fec_url)
      .map((c) => c.contribution.fec_url as string)
      .slice(0, 5) ?? [];

  const evidence: string[] = [];
  if (!has_hits) {
    evidence.push(`FEC strict + state_only: no Schedule A rows for ${params.voter.name.full}.`);
  } else if (!scored.identity.probable_same_person) {
    evidence.push(
      `FEC ${params.match_level}: ${scored.identity.contributions.length} row(s) returned; identity band ${scored.identity.identity_band} (best score ${Math.round(scored.identity.best_score * 100)}%) — not confirmed for this voter.`,
    );
    if (top) {
      evidence.push(
        `Top hit: ${top.contribution.contributor_name ?? '?'} · ${top.contribution.contributor_city ?? '?'} ${top.contribution.contributor_zip ?? ''}`,
      );
    }
  } else if (scored.donation_lean) {
    evidence.push(...scored.donation_lean.evidence);
  }

  return {
    upload_id: params.upload_id,
    voter_record_id: params.voter_record_id,
    user_id: params.user_id,
    arm: 'fec',
    source: 'fec_sweep',
    identity_band: scored.identity.identity_band,
    identity_score: scored.identity.best_score,
    probable_same_person: scored.identity.probable_same_person,
    lean_signal: scored.fec_lean,
    lean_confidence: scored.fec_lean_confidence,
    evidence,
    urls,
    payload: {
      dedupe_key: params.sweep_job_id,
      match_level: params.match_level,
      has_hits,
      contributor_name: params.voter.name.full,
      fec_query_names: anchorProfile.fec_query_names,
    },
    cost_usd: 0,
    dedupe_key: params.sweep_job_id,
  };
}