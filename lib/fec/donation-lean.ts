import type { FecContributionHit } from '@/lib/fec/contributor-lookup';
import type { LeanLabel } from '@/lib/enrichment/types';
import type { ScoredFecContribution } from '@/lib/fec/identity-match';
import {
  getFallbackLeanPatterns,
  scanLeanPatterns,
  type LeanPatternSets,
} from '@/lib/lean-patterns/patterns';

export interface DonationLeanHit {
  lean: LeanLabel;
  confidence: number;
  evidence: string;
  committee_name: string | null;
  candidate_name: string | null;
  amount: number | null;
  receipt_date: string | null;
  fec_url: string | null;
  identity_score: number;
}

export interface DonationLeanResult {
  lean: LeanLabel;
  confidence: number;
  lean_signals_found: boolean;
  evidence: string[];
  hits: DonationLeanHit[];
}

interface LeanSignal {
  lean: LeanLabel;
  confidence: number;
  reason: string;
}

// Patterns live in the lean_patterns registry (migration 019) with
// lib/lean-patterns/patterns.ts as the single fallback source — never
// re-hardcode a list here (that fork is how DEF-005/006 happened).
function inferContributionLean(
  contribution: FecContributionHit,
  patterns: LeanPatternSets,
): LeanSignal | null {
  const text = [contribution.committee_name, contribution.candidate_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!text) return null;

  const match = scanLeanPatterns(text, patterns.fec);
  return match ? { lean: match.lean, confidence: match.confidence, reason: match.label } : null;
}

function aggregateLean(hits: DonationLeanHit[]): {
  lean: LeanLabel;
  confidence: number;
  evidence: string[];
} {
  if (hits.length === 0) {
    return { lean: 'Undetermined', confidence: 0, evidence: [] };
  }

  const weights = hits.map((h) => {
    const amountBoost = h.amount && h.amount > 0 ? Math.min(1.2, 1 + Math.log10(h.amount) / 10) : 1;
    return h.confidence * amountBoost * h.identity_score;
  });

  const leanScores: Record<LeanLabel, number> = {
    Left: 0,
    Right: 0,
    Independent: 0,
    Undetermined: 0,
  };

  for (let i = 0; i < hits.length; i += 1) {
    leanScores[hits[i].lean] += weights[i];
  }

  const ranked = (Object.entries(leanScores) as [LeanLabel, number][])
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return { lean: 'Undetermined', confidence: 20, evidence: ['FEC hits present but recipient party unclear'] };
  }

  const [topLean, topWeight] = ranked[0];
  const secondWeight = ranked[1]?.[1] ?? 0;

  if (topLean === 'Independent') {
    return {
      lean: 'Independent',
      confidence: Math.min(60, Math.round(hits[0].confidence * 0.85)),
      evidence: hits.map((h) => h.evidence),
    };
  }

  if (secondWeight > 0 && topWeight / secondWeight < 1.35) {
    return {
      lean: 'Undetermined',
      confidence: 35,
      evidence: [
        ...hits.map((h) => h.evidence),
        'Mixed partisan signals across confirmed FEC contributions',
      ],
    };
  }

  const confidence = Math.min(
    95,
    Math.round(
      hits
        .filter((h) => h.lean === topLean)
        .reduce((sum, h) => sum + h.confidence * h.identity_score, 0) /
        Math.max(
          1,
          hits.filter((h) => h.lean === topLean).reduce((sum, h) => sum + h.identity_score, 0),
        ),
    ),
  );

  return {
    lean: topLean,
    confidence,
    evidence: hits.filter((h) => h.lean === topLean).map((h) => h.evidence),
  };
}

/**
 * Map confirmed/probable FEC contributions to ideological lean from recipient metadata.
 */
export function inferLeanFromDonations(
  scoredContributions: ScoredFecContribution[],
  options?: { minIdentityScore?: number; patterns?: LeanPatternSets },
): DonationLeanResult {
  const minScore = options?.minIdentityScore ?? 0.55;
  const patterns = options?.patterns ?? getFallbackLeanPatterns();
  const eligible = scoredContributions.filter((s) => s.identity_score >= minScore);

  const hits: DonationLeanHit[] = [];

  for (const scored of eligible) {
    const signal = inferContributionLean(scored.contribution, patterns);
    if (!signal) continue;

    const amount = scored.contribution.amount;
    const committee = scored.contribution.committee_name;
    const candidate = scored.contribution.candidate_name;
    const recipient = committee ?? candidate ?? 'unknown recipient';

    hits.push({
      lean: signal.lean,
      confidence: signal.confidence,
      evidence: `FEC donation to ${recipient}: ${signal.reason}`,
      committee_name: committee,
      candidate_name: candidate,
      amount,
      receipt_date: scored.contribution.receipt_date,
      fec_url: scored.contribution.fec_url,
      identity_score: scored.identity_score,
    });
  }

  const aggregated = aggregateLean(hits);

  return {
    lean: aggregated.lean,
    confidence: aggregated.confidence,
    lean_signals_found: aggregated.lean !== 'Undetermined' && aggregated.confidence >= 45,
    evidence: aggregated.evidence,
    hits,
  };
}