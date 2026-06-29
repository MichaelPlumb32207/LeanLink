import { normalizeCity, zip5 } from '@/lib/reference-data/normalize';
import type { FecIdentityBand } from '@/lib/fec/identity-match';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { FlContributionHit } from '@/lib/fl-contrib/types';

export interface FlContribIdentityResult {
  identity_band: FecIdentityBand;
  identity_score: number;
  probable_same_person: boolean;
  best_hit: FlContributionHit | null;
  hit_count: number;
}

function nameTokens(voter: ParsedFlVoterRecord, contributor: string): number {
  const vLast = voter.name.last.toLowerCase();
  const vFirst = voter.name.first.toLowerCase();
  const parts = contributor.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 0;
  let score = 0;
  const cLast = parts[parts.length - 1];
  const cFirst = parts[0];
  if (vLast && cLast === vLast) score += 0.2;
  if (vFirst && cFirst === vFirst) score += 0.15;
  return score;
}

export function scoreFlContributionsAgainstVoter(params: {
  voter: ParsedFlVoterRecord;
  hits: FlContributionHit[];
  match_layer: 1 | 2;
}): FlContribIdentityResult {
  const { voter, hits, match_layer } = params;
  if (hits.length === 0) {
    return {
      identity_band: 'none',
      identity_score: 0,
      probable_same_person: false,
      best_hit: null,
      hit_count: 0,
    };
  }

  const voterZip = zip5(voter.residence.zip);
  const voterCity = normalizeCity(voter.residence.city);

  let bestScore = 0;
  let bestHit: FlContributionHit | null = null;

  for (const hit of hits) {
    let score = match_layer === 2 ? 0.25 : 0.2;
    if (match_layer === 2) score += 0.1;

    const hitZip = hit.zip5 ?? '';
    if (voterZip && hitZip) {
      score += voterZip === hitZip ? 0.35 : -0.2;
    }
    const hitCity = normalizeCity(hit.city ?? '');
    if (voterCity && hitCity) {
      score += voterCity === hitCity ? 0.2 : hitCity.includes(voterCity) ? 0.1 : -0.1;
    }
    score += nameTokens(voter, hit.contributor_name);
    score = Math.min(1, Math.max(0, score));

    if (score > bestScore) {
      bestScore = score;
      bestHit = hit;
    }
  }

  const hasZip = Boolean(
    voterZip && bestHit?.zip5 && voterZip === bestHit.zip5,
  );
  const hasCity = Boolean(
    voterCity && bestHit?.city && normalizeCity(bestHit.city) === voterCity,
  );

  let identity_band: FecIdentityBand = 'none';
  if (match_layer === 2) {
    if (bestScore >= 0.45) identity_band = 'probable';
    else if (bestScore >= 0.3) identity_band = 'ambiguous';
    else identity_band = 'unlikely';
  } else if (bestScore >= 0.75 && hasZip && hasCity) {
    identity_band = 'confirmed';
  } else if (bestScore >= 0.55) {
    identity_band = 'probable';
  } else if (bestScore >= 0.35) {
    identity_band = 'ambiguous';
  } else if (bestScore > 0) {
    identity_band = 'unlikely';
  }

  const probable_same_person =
    identity_band === 'confirmed' ||
    (identity_band === 'probable' && match_layer === 1);

  return {
    identity_band,
    identity_score: Math.round(bestScore * 1000) / 1000,
    probable_same_person,
    best_hit: bestHit,
    hit_count: hits.length,
  };
}