import { buildEnrichmentBundle, historyToContext } from '@/lib/enrichment/build-bundle';
import { parseEnrichmentMode } from '@/lib/enrichment/modes';
import { grokEnrichAndInferRecord } from '@/lib/enrichment/grok-pipeline';
import type { LeanLabel } from '@/lib/enrichment/types';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { summarizeVoterHistory } from '@/lib/fl-voter-history';
import { getXaiApiKey } from '@/lib/xai/client';

export type { LeanLabel };

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
    grok_raw_excerpt?: string;
    citations?: string[];
  };
}

function confidenceBand(confidence: number): string {
  if (confidence >= 70) return 'High';
  if (confidence >= 45) return 'Medium';
  return 'Low';
}

/** Fallback when XAI_API_KEY is absent or Grok call fails in dev. */
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

function mockInferLean(
  record: ParsedFlVoterRecord,
  history: VoterHistorySummary,
  ballotFavors: BallotFavors,
): LeanInferenceResult {
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
    `Lean estimate: ${leanLabel} (fallback mock — XAI_API_KEY missing or Grok unavailable)`,
    `Turnout propensity: ${history.turnout_propensity} — voted in ${history.general_elections_voted} of ${history.general_elections_available} general elections on file`,
    `Primary engagement: ${history.primary_engagement} (engagement only, not party lean)`,
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
    matched_social: [],
    turnout_propensity: history.turnout_propensity,
    turnout_score: history.turnout_score,
    primary_engagement: history.primary_engagement,
    opposition_mobilization_score: oppositionScore,
    audit: {
      timestamp: new Date().toISOString(),
      sources: ['FL-Voting-History', 'Fallback-Mock'],
      model_version: 'fallback-mock-v3',
      ballot_favors: ballotFavors,
    },
  };
}

function appendHistoryEvidence(evidence: string[], history: VoterHistorySummary): string[] {
  return [
    ...evidence,
    `Turnout propensity: ${history.turnout_propensity} (${history.general_elections_voted}/${history.general_elections_available} generals)`,
    `Primary engagement: ${history.primary_engagement} (mobilization context only)`,
    history.last_vote_date ? `Last voted: ${history.last_vote_date}` : 'No votes in history file',
  ];
}

export async function inferLean(
  record: ParsedFlVoterRecord,
  historySummary: VoterHistorySummary | null | undefined,
  ballotFavors: BallotFavors = 'south',
): Promise<LeanInferenceResult> {
  const history =
    historySummary ?? summarizeVoterHistory(undefined, new Set());

  if (!getXaiApiKey()) {
    return mockInferLean(record, history, ballotFavors);
  }

  try {
    const mode = parseEnrichmentMode(process.env.ENRICHMENT_MODE);
    const grok = await grokEnrichAndInferRecord(record, historySummary, ballotFavors, {
      mode,
    });
    const oppositionScore = computeOppositionMobilizationScore(
      history.turnout_score,
      grok.confidence,
      grok.lean,
      ballotFavors,
    );

    const evidence = appendHistoryEvidence(grok.evidence, history);
    evidence.push(
      `Identity resolution: ${grok.enrichment.identity_resolution_status} (best match ${Math.round(grok.enrichment.identity_best_match_score * 100)}%)`,
      grok.enrichment.lean_signals_found
        ? 'Ideological signals found in public content'
        : 'No ideological signals — lean intentionally Undetermined',
      `Pipeline: ${grok.enrichment.pipeline_mode}`,
      grok.enrichment.search_summary,
      `Ballot favors ${ballotFavors} — opposition mobilization score ${oppositionScore}`,
    );

    return {
      lean: grok.lean,
      confidence: grok.confidence,
      confidence_band: confidenceBand(grok.confidence),
      evidence,
      matched_social: grok.matched_social,
      turnout_propensity: history.turnout_propensity,
      turnout_score: history.turnout_score,
      primary_engagement: history.primary_engagement,
      opposition_mobilization_score: oppositionScore,
      audit: grok.audit,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Grok inference failed';
    const fallback = mockInferLean(record, history, ballotFavors);
    fallback.evidence.unshift(`Grok pipeline error: ${message}`);
    fallback.audit.sources.push('Grok-Error-Fallback');
    return fallback;
  }
}

/** Expose bundle builder for test endpoint. */
export { buildEnrichmentBundle, historyToContext };