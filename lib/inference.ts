import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { summarizeVoterHistory } from '@/lib/fl-voter-history';

export type LeanLabel = 'Left' | 'Right' | 'Independent' | 'Undetermined';

export interface LeanInferenceResult {
  lean: LeanLabel;
  confidence: number;
  confidence_band: string;
  evidence: string[];
  matched_social: string[];
  turnout_propensity: string;
  turnout_score: number;
  primary_engagement: string;
  opposition_mobilization_score: number;
  audit: {
    timestamp: string;
    sources: string[];
    model_version: string;
    ballot_favors: BallotFavors;
  };
}

function confidenceBand(confidence: number): string {
  if (confidence >= 70) return 'High';
  if (confidence >= 45) return 'Medium';
  return 'Low';
}

/** Placeholder lean until Grok is wired; stable per voter_id. */
function mockLeanDirection(record: ParsedFlVoterRecord): LeanLabel {
  const seed = record.voterId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const options: LeanLabel[] = ['Left', 'Right', 'Independent', 'Undetermined'];
  return options[seed % options.length];
}

function mockLeanConfidence(record: ParsedFlVoterRecord, history: VoterHistorySummary): number {
  const seed = record.voterId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  let confidence = 35 + (seed % 40);

  if (history.turnout_score >= 70) confidence += 10;
  else if (history.turnout_score >= 40) confidence += 5;

  if (history.primary_count > 0) confidence += 8;

  return Math.min(confidence, 90);
}

/**
 * North = Left, South = Right for opposition mobilization scoring.
 * High score = more likely to turn out in opposition when contacted about
 * an issue favored by the opposite camp.
 */
export function oppositionFactor(lean: LeanLabel, ballotFavors: BallotFavors): number {
  if (lean === 'Independent' || lean === 'Undetermined') return 0.5;

  const leansNorth = lean === 'Left';
  const leansSouth = lean === 'Right';

  if (ballotFavors === 'south' && leansNorth) return 1.0;
  if (ballotFavors === 'north' && leansSouth) return 1.0;
  if (ballotFavors === 'south' && leansSouth) return 0.15;
  if (ballotFavors === 'north' && leansNorth) return 0.15;

  return 0.4;
}

export function computeOppositionMobilizationScore(
  turnoutScore: number,
  confidence: number,
  lean: LeanLabel,
  ballotFavors: BallotFavors,
): number {
  const factor = oppositionFactor(lean, ballotFavors);
  return Math.round(turnoutScore * (confidence / 100) * factor);
}

export function inferLean(
  record: ParsedFlVoterRecord,
  historySummary: VoterHistorySummary | null | undefined,
  ballotFavors: BallotFavors = 'south',
): LeanInferenceResult {
  const history =
    historySummary ??
    summarizeVoterHistory(undefined, new Set());

  const lean = mockLeanDirection(record);
  const confidence = mockLeanConfidence(record, history);
  const oppositionScore = computeOppositionMobilizationScore(
    history.turnout_score,
    confidence,
    lean,
    ballotFavors,
  );

  const leanLabel =
    lean === 'Left' ? 'north (Left)' : lean === 'Right' ? 'south (Right)' : lean;

  const evidence = [
    `Lean estimate: ${leanLabel} (mock-v2 — Grok pending)`,
    `Turnout propensity: ${history.turnout_propensity} — voted in ${history.general_elections_voted} of ${history.general_elections_available} general elections on file`,
    `Primary engagement: ${history.primary_engagement}`,
    history.last_vote_date
      ? `Last voted: ${history.last_vote_date}`
      : 'No recorded votes in history file',
    `Ballot favors ${ballotFavors} — opposition mobilization score ${oppositionScore}`,
    record.email ? 'Email on voter file' : 'No email on voter file',
    record.phone ? 'Phone on voter file' : 'No phone on voter file',
  ];

  return {
    lean,
    confidence,
    confidence_band: confidenceBand(confidence),
    evidence,
    matched_social: record.email ? [`possible-match-${record.voterId}@social.stub`] : [],
    turnout_propensity: history.turnout_propensity,
    turnout_score: history.turnout_score,
    primary_engagement: history.primary_engagement,
    opposition_mobilization_score: oppositionScore,
    audit: {
      timestamp: new Date().toISOString(),
      sources: ['FL-Voting-History', 'MockLean-v2'],
      model_version: 'history-aware-mock-v2',
      ballot_favors: ballotFavors,
    },
  };
}