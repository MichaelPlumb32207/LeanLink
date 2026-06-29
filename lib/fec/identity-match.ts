import type { FecContributionHit, FecMatchLevel } from '@/lib/fec/contributor-lookup';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { ResolutionStatus } from '@/lib/enrichment/types';

export type FecIdentityBand = 'confirmed' | 'probable' | 'ambiguous' | 'unlikely' | 'none';

export interface ScoredFecContribution {
  contribution: FecContributionHit;
  identity_score: number;
  match_reasons: string[];
  probable_same_person: boolean;
}

export interface FecIdentityMatchResult {
  match_level: FecMatchLevel | 'none';
  contributions: ScoredFecContribution[];
  best_score: number;
  identity_band: FecIdentityBand;
  probable_same_person: boolean;
  confirmed_contribution_count: number;
  identity_resolution_status: ResolutionStatus;
}

function normalizeCity(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\bst\b/g, 'saint')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function zip5(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  return digits.slice(0, 5);
}

function parseNameTokens(name: string): { first: string; middle: string; last: string } {
  const parts = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return { first: '', middle: '', last: '' };
  if (parts.length === 1) return { first: parts[0], middle: '', last: parts[0] };

  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
  const filtered = parts.filter((p) => !suffixes.has(p));
  if (filtered.length === 0) return { first: '', middle: '', last: '' };
  if (filtered.length === 1) return { first: filtered[0], middle: '', last: filtered[0] };

  const last = filtered[filtered.length - 1];
  const first = filtered[0];
  const middle = filtered.length > 2 ? filtered.slice(1, -1).join(' ') : '';
  return { first, middle, last };
}

function nameTokenScore(voter: ParsedFlVoterRecord, contributorName: string | null): {
  score: number;
  reasons: string[];
} {
  const voterTokens = {
    first: voter.name.first.toLowerCase(),
    middle: voter.name.middle.toLowerCase(),
    last: voter.name.last.toLowerCase(),
  };
  const contrib = parseNameTokens(contributorName ?? '');
  let score = 0;
  const reasons: string[] = [];

  if (voterTokens.last && contrib.last && voterTokens.last === contrib.last) {
    score += 0.15;
    reasons.push('last_name_match');
  } else if (voterTokens.last && contrib.last) {
    score -= 0.1;
    reasons.push('last_name_mismatch');
  }

  if (voterTokens.first && contrib.first && voterTokens.first === contrib.first) {
    score += 0.1;
    reasons.push('first_name_match');
  } else if (voterTokens.first && contrib.first) {
    score -= 0.05;
    reasons.push('first_name_mismatch');
  }

  if (voterTokens.middle && contrib.middle) {
    const voterMi = voterTokens.middle.charAt(0);
    const contribMi = contrib.middle.charAt(0);
    if (voterMi && contribMi && voterMi === contribMi) {
      score += 0.05;
      reasons.push('middle_initial_match');
    }
  }

  return { score, reasons };
}

function scoreContribution(
  voter: ParsedFlVoterRecord,
  contribution: FecContributionHit,
  matchLevel: FecMatchLevel | 'none',
): ScoredFecContribution {
  const reasons: string[] = [];
  let score = matchLevel === 'strict' ? 0.35 : matchLevel === 'state_only' ? 0.15 : 0;

  if (matchLevel === 'strict') reasons.push('fec_query_strict');
  if (matchLevel === 'state_only') reasons.push('fec_query_state_only');

  const voterZip = zip5(voter.residence.zip);
  const contribZip = zip5(contribution.contributor_zip);
  if (voterZip && contribZip) {
    if (voterZip === contribZip) {
      score += 0.35;
      reasons.push('zip5_match');
    } else {
      score -= 0.25;
      reasons.push('zip5_mismatch');
    }
  } else if (matchLevel === 'strict' && voterZip) {
    score += 0.1;
    reasons.push('strict_query_zip_filter');
  }

  const voterCity = normalizeCity(voter.residence.city);
  const contribCity = normalizeCity(contribution.contributor_city);
  if (voterCity && contribCity) {
    if (voterCity === contribCity) {
      score += 0.2;
      reasons.push('city_match');
    } else if (voterCity.includes(contribCity) || contribCity.includes(voterCity)) {
      score += 0.1;
      reasons.push('city_partial_match');
    } else {
      score -= 0.15;
      reasons.push('city_mismatch');
    }
  } else if (matchLevel === 'strict' && voterCity) {
    score += 0.08;
    reasons.push('strict_query_city_filter');
  }

  const contribState = (contribution.contributor_state ?? '').toUpperCase();
  if (contribState === 'FL' || contribState === '') {
    score += 0.05;
    reasons.push('contributor_florida');
  }

  const nameResult = nameTokenScore(voter, contribution.contributor_name);
  score += nameResult.score;
  reasons.push(...nameResult.reasons);

  const clamped = Math.min(1, Math.max(0, score));
  return {
    contribution,
    identity_score: Math.round(clamped * 1000) / 1000,
    match_reasons: reasons,
    probable_same_person: clamped >= 0.55,
  };
}

function toIdentityBand(
  bestScore: number,
  secondScore: number,
  matchLevel: FecMatchLevel | 'none',
  hasZipMatch: boolean,
  hasCityMatch: boolean,
  hitCount: number,
): FecIdentityBand {
  if (hitCount === 0) return 'none';

  if (bestScore >= 0.75 && hasZipMatch && hasCityMatch) return 'confirmed';
  if (bestScore >= 0.55 && bestScore - secondScore >= 0.12) return 'probable';
  if (bestScore >= 0.35 && (hitCount > 1 || matchLevel === 'state_only')) return 'ambiguous';
  if (bestScore >= 0.35) return 'probable';
  if (bestScore > 0) return 'unlikely';
  return 'none';
}

function toResolutionStatus(band: FecIdentityBand): ResolutionStatus {
  if (band === 'confirmed' || band === 'probable') return 'probable';
  if (band === 'ambiguous') return 'ambiguous';
  return 'none';
}

/**
 * Deterministic identity scoring: each FEC contribution vs voter anchor on file.
 */
export function scoreFecContributionsAgainstVoter(params: {
  voter: ParsedFlVoterRecord;
  contributions: FecContributionHit[];
  matchLevel: FecMatchLevel | 'none';
}): FecIdentityMatchResult {
  const scored = params.contributions.map((c) =>
    scoreContribution(params.voter, c, params.matchLevel),
  );
  scored.sort((a, b) => b.identity_score - a.identity_score);

  const best = scored[0];
  const second = scored[1];
  const bestScore = best?.identity_score ?? 0;
  const secondScore = second?.identity_score ?? 0;

  const bestReasons = best?.match_reasons ?? [];
  const hasZipMatch = bestReasons.includes('zip5_match');
  const hasCityMatch =
    bestReasons.includes('city_match') || bestReasons.includes('city_partial_match');

  const identity_band = toIdentityBand(
    bestScore,
    secondScore,
    params.matchLevel,
    hasZipMatch,
    hasCityMatch,
    scored.length,
  );

  const probable_same_person =
    identity_band === 'confirmed' ||
    (identity_band === 'probable' && bestScore - secondScore >= 0.12);

  const confirmed_contribution_count = scored.filter(
    (s) => s.identity_score >= 0.75 && s.match_reasons.includes('zip5_match'),
  ).length;

  return {
    match_level: params.matchLevel,
    contributions: scored,
    best_score: bestScore,
    identity_band,
    probable_same_person,
    confirmed_contribution_count,
    identity_resolution_status: toResolutionStatus(identity_band),
  };
}