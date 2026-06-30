import type { FecContributionHit } from '@/lib/fec/contributor-lookup';
import type { LeanLabel } from '@/lib/enrichment/types';
import type { ScoredFecContribution } from '@/lib/fec/identity-match';

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

const RIGHT_PATTERNS: { pattern: RegExp; confidence: number; label: string }[] = [
  { pattern: /\bwinred\b/i, confidence: 90, label: 'WinRed conduit' },
  { pattern: /\btrump\b/i, confidence: 88, label: 'Trump-affiliated recipient' },
  { pattern: /\brepublican\b/i, confidence: 85, label: 'Republican committee/candidate' },
  { pattern: /\bkatherine\s+harris\b/i, confidence: 88, label: 'Katherine Harris (R)' },
  { pattern: /\b(?:rnc|gop)\b/i, confidence: 85, label: 'RNC/GOP' },
  { pattern: /\bmaga\b/i, confidence: 82, label: 'MAGA-affiliated' },
  { pattern: /\bconservative\b/i, confidence: 70, label: 'Conservative committee' },
  { pattern: /\bliberty\b/i, confidence: 65, label: 'Liberty-oriented PAC' },
  { pattern: /\b\(rep\)/i, confidence: 82, label: 'FL recipient (REP)' },
];

const LEFT_PATTERNS: { pattern: RegExp; confidence: number; label: string }[] = [
  { pattern: /\bactblue\b/i, confidence: 90, label: 'ActBlue conduit' },
  { pattern: /\bdemocrat(ic)?\b/i, confidence: 85, label: 'Democratic committee/candidate' },
  { pattern: /\b(?:dnc|democratic national)\b/i, confidence: 85, label: 'DNC' },
  { pattern: /\bbiden\b/i, confidence: 82, label: 'Biden-affiliated' },
  { pattern: /\b(?:kamala\s+)?harris\s+(?:for|2024)\b/i, confidence: 80, label: 'Harris campaign' },
  { pattern: /\bprogressive\b/i, confidence: 72, label: 'Progressive committee' },
  { pattern: /\b(?:emily'?s list|moveon)\b/i, confidence: 78, label: 'Progressive advocacy PAC' },
  { pattern: /\b\(dem\)/i, confidence: 82, label: 'FL recipient (DEM)' },
];

const NEUTRAL_PATTERNS: { pattern: RegExp; confidence: number; label: string }[] = [
  { pattern: /\b(?:bipartisan|nonpartisan|independent)\b/i, confidence: 55, label: 'Nonpartisan committee' },
];

function scanText(text: string, patterns: typeof RIGHT_PATTERNS): LeanSignal | null {
  for (const { pattern, confidence, label } of patterns) {
    if (pattern.test(text)) {
      return { lean: patterns === RIGHT_PATTERNS ? 'Right' : 'Left', confidence, reason: label };
    }
  }
  return null;
}

function inferContributionLean(contribution: FecContributionHit): LeanSignal | null {
  const text = [contribution.committee_name, contribution.candidate_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!text) return null;

  const right = scanText(text, RIGHT_PATTERNS);
  if (right) return right;

  const left = scanText(text, LEFT_PATTERNS);
  if (left) return left;

  for (const { pattern, confidence, label } of NEUTRAL_PATTERNS) {
    if (pattern.test(text)) {
      return { lean: 'Independent', confidence, reason: label };
    }
  }

  return null;
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
  options?: { minIdentityScore?: number },
): DonationLeanResult {
  const minScore = options?.minIdentityScore ?? 0.55;
  const eligible = scoredContributions.filter((s) => s.identity_score >= minScore);

  const hits: DonationLeanHit[] = [];

  for (const scored of eligible) {
    const signal = inferContributionLean(scored.contribution);
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