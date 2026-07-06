import { normalizeCity, zip5 } from '@/lib/reference-data/normalize';
import { addressCorroboration, isAddressCorroborated } from '@/lib/reference-data/address-match';
import type { FecIdentityBand } from '@/lib/fec/identity-match';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { FlContributionHit } from '@/lib/fl-contrib/types';

/**
 * Address churn makes a stale zip match weaker proof of *current* identity: a
 * voter may have moved into a zip a donor left years ago. Full weight within
 * ~4 years, decaying to 0.5× beyond ~12. No/unparseable date → full weight.
 */
function zipRecencyFactor(dateStr: string | null | undefined, now: Date): number {
  if (!dateStr) return 1;
  const d = new Date(dateStr);
  const t = d.getTime();
  if (Number.isNaN(t)) return 1;
  const years = (now.getTime() - t) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 4) return 1;
  if (years >= 12) return 0.5;
  return 1 - 0.5 * ((years - 4) / 8);
}

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
  /** Reference time for the zip-recency penalty; defaults to now (deterministic in tests). */
  now?: Date;
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

  const now = params.now ?? new Date();
  const voterZip = zip5(voter.residence.zip);
  const voterCity = normalizeCity(voter.residence.city);
  const voterLine1 = voter.residence.line1;

  let bestScore = 0;
  let bestHit: FlContributionHit | null = null;

  for (const hit of hits) {
    let score = match_layer === 2 ? 0.25 : 0.2;
    if (match_layer === 2) score += 0.1;

    const hitZip = hit.zip5 ?? '';
    if (voterZip && hitZip) {
      // ENH-013: a zip *match* is discounted by contribution age (churn); a
      // zip *mismatch* penalty is not — a mismatch is a mismatch regardless.
      score += voterZip === hitZip ? 0.35 * zipRecencyFactor(hit.contribution_date, now) : -0.2;
    }
    const hitCity = normalizeCity(hit.city ?? '');
    if (voterCity && hitCity) {
      score += voterCity === hitCity ? 0.2 : hitCity.includes(voterCity) ? 0.1 : -0.1;
    }
    score += nameTokens(voter, hit.contributor_name);

    // ENH-013: street-address corroboration — additive here (unlike the Sunbiz
    // hard gate) so zip+name can still qualify, but it lifts the weak-band
    // matches that identity gating otherwise withholds.
    const corr = addressCorroboration(voterLine1, hit.address);
    if (isAddressCorroborated(corr)) score += 0.2;
    else if (corr === 'partial') score += 0.08;
    else if (corr === 'mismatch') score -= 0.15;

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