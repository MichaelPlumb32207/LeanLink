import { buildEnrichmentBundle } from '@/lib/enrichment/build-bundle';
import {
  applyInferenceGuardrails,
  parseJsonFromModelText,
} from '@/lib/enrichment/grok-pipeline';
import { buildFecDisambiguateSystemPrompt, buildFecDisambiguateUserPrompt } from '@/lib/enrichment/prompts';
import type { EnrichmentResult, GrokPipelineResult } from '@/lib/enrichment/types';
import type { FecContributionHit } from '@/lib/fec/contributor-lookup';
import { inferLeanFromDonations } from '@/lib/fec/donation-lean';
import {
  scoreFecContributionsAgainstVoter,
  type FecIdentityMatchResult,
} from '@/lib/fec/identity-match';
import type { DonationLeanResult } from '@/lib/fec/donation-lean';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { getXaiModel, xaiResponsesWithWebSearch, type XaiUsageSummary } from '@/lib/xai/client';

export interface FecDisambiguateInput {
  voter: ParsedFlVoterRecord;
  contributions: FecContributionHit[];
  matchLevel: 'strict' | 'state_only' | 'none';
  historySummary?: VoterHistorySummary | null;
  ballotFavors?: BallotFavors;
}

export interface FecDisambiguateResult {
  deterministic: {
    identity: FecIdentityMatchResult;
    donation_lean: DonationLeanResult | null;
  };
  grok_used: boolean;
  grok_skip_reason: string | null;
  enrichment: EnrichmentResult;
  lean: GrokPipelineResult['lean'];
  confidence: number;
  evidence: string[];
  matched_social: string[];
  audit: GrokPipelineResult['audit'];
  usage: XaiUsageSummary | null;
}

function deterministicToEnrichment(
  identity: FecIdentityMatchResult,
  donationLean: DonationLeanResult | null,
): Pick<FecDisambiguateResult, 'enrichment' | 'lean' | 'confidence' | 'evidence' | 'matched_social'> {
  const topContributions = identity.contributions.filter((c) => c.probable_same_person).slice(0, 5);

  const identity_matches = topContributions.map((scored) => ({
    platform: 'donation',
    url: scored.contribution.fec_url ?? '',
    match_score: scored.identity_score,
    match_reasons: scored.match_reasons,
    signals: donationLean?.hits
      .filter((h) => h.fec_url === scored.contribution.fec_url)
      .map((h) => h.evidence) ?? [],
  }));

  const lean = donationLean?.lean_signals_found ? donationLean.lean : 'Undetermined';
  const confidence = donationLean?.lean_signals_found ? donationLean.confidence : 25;

  return {
    enrichment: {
      resolution_status: identity.identity_resolution_status,
      identity_resolution_status: identity.identity_resolution_status,
      identity_best_match_score: identity.best_score,
      identity_matches,
      lean_signals_found: Boolean(donationLean?.lean_signals_found),
      matches: identity_matches,
      best_match_score: identity.best_score,
      search_summary: `Deterministic FEC identity scoring (${identity.identity_band}); Grok skipped.`,
      citations: identity_matches.map((m) => m.url).filter(Boolean),
      search_queries: [],
      pipeline_mode: 'fec-disambiguate',
    },
    lean,
    confidence,
    evidence: donationLean?.evidence ?? [
      `FEC identity band: ${identity.identity_band} (best score ${Math.round(identity.best_score * 100)}%)`,
    ],
    matched_social: [],
  };
}

function shouldRunGrok(identity: FecIdentityMatchResult): { run: boolean; reason: string } {
  if (identity.contributions.length === 0) {
    return { run: false, reason: 'no_fec_hits' };
  }
  if (identity.identity_band === 'confirmed') {
    return { run: false, reason: 'deterministic_confirmed' };
  }
  if (identity.identity_band === 'probable' && identity.probable_same_person) {
    return { run: false, reason: 'deterministic_probable' };
  }
  if (identity.identity_band === 'unlikely') {
    return { run: false, reason: 'deterministic_unlikely' };
  }
  return { run: true, reason: 'ambiguous_requires_grok' };
}

export async function runFecDisambiguatePipeline(
  input: FecDisambiguateInput,
): Promise<FecDisambiguateResult> {
  const bundle = buildEnrichmentBundle(
    input.voter,
    input.historySummary,
    input.ballotFavors ?? 'south',
  );

  const identity = scoreFecContributionsAgainstVoter({
    voter: input.voter,
    contributions: input.contributions,
    matchLevel: input.matchLevel,
  });

  const donation_lean =
    identity.probable_same_person && identity.contributions.length > 0
      ? inferLeanFromDonations(identity.contributions)
      : null;

  const grokDecision = shouldRunGrok(identity);

  if (!grokDecision.run) {
    const mapped = deterministicToEnrichment(identity, donation_lean);
    return {
      deterministic: { identity, donation_lean },
      grok_used: false,
      grok_skip_reason: grokDecision.reason,
      ...mapped,
      audit: {
        timestamp: new Date().toISOString(),
        sources: ['FEC-Identity-Match', 'FEC-Donation-Lean', 'FL-Voter-File'],
        model_version: 'deterministic',
        ballot_favors: bundle.ballot_favors,
        pipeline_mode: 'fec-disambiguate',
      },
      usage: null,
    };
  }

  const systemPrompt = buildFecDisambiguateSystemPrompt();
  const userPrompt = buildFecDisambiguateUserPrompt(bundle, identity, input.contributions);
  const model = getXaiModel();

  const response = await xaiResponsesWithWebSearch({
    model,
    systemPrompt,
    userPrompt,
    enableWebSearch: true,
    enableXSearch: false,
  });

  const parsedRaw = parseJsonFromModelText(response.text);
  const parsed = applyInferenceGuardrails(parsedRaw);

  const grokDonationLean =
    parsed.lean_signals_found && parsed.identity_resolution_status === 'probable'
      ? {
          lean: parsed.lean,
          confidence: parsed.lean_confidence,
          evidence: parsed.evidence,
        }
      : null;

  const finalLean = grokDonationLean?.lean ?? donation_lean?.lean ?? parsed.lean;
  const finalConfidence =
    grokDonationLean?.confidence ??
    donation_lean?.confidence ??
    (parsed.lean_signals_found ? parsed.lean_confidence : 25);

  const evidence = [
    ...(donation_lean?.evidence ?? []),
    ...parsed.evidence,
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  return {
    deterministic: { identity, donation_lean },
    grok_used: true,
    grok_skip_reason: null,
    enrichment: {
      resolution_status: parsed.identity_resolution_status,
      identity_resolution_status: parsed.identity_resolution_status,
      identity_best_match_score: Math.max(parsed.identity_best_match_score, identity.best_score),
      identity_matches: parsed.identity_matches,
      lean_signals_found: parsed.lean_signals_found || Boolean(donation_lean?.lean_signals_found),
      matches: parsed.identity_matches,
      best_match_score: Math.max(parsed.identity_best_match_score, identity.best_score),
      search_summary: parsed.search_summary,
      citations: response.citations,
      search_queries: [],
      pipeline_mode: 'fec-disambiguate',
    },
    lean: finalLean,
    confidence: finalConfidence,
    evidence,
    matched_social: [],
    audit: {
      timestamp: new Date().toISOString(),
      sources: ['FEC-Identity-Match', 'FEC-Donation-Lean', 'Grok-FEC-Disambiguate', 'web_search'],
      model_version: model,
      ballot_favors: bundle.ballot_favors,
      pipeline_mode: 'fec-disambiguate',
      grok_raw_excerpt: response.text.slice(0, 2000),
      citations: response.citations,
    },
    usage: response.usage,
  };
}