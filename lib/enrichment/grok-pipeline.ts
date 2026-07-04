import { buildSearchQueryPlan } from '@/lib/enrichment/query-builder';
import { buildSystemPrompt, buildUserPrompt } from '@/lib/enrichment/prompts';
import type { EnrichmentMode } from '@/lib/enrichment/modes';
import type {
  EnrichmentBundle,
  EnrichmentResult,
  GrokInferencePayload,
  GrokPipelineResult,
  LeanLabel,
  OsintMatch,
  ResolutionStatus,
} from '@/lib/enrichment/types';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import { buildEnrichmentBundle } from '@/lib/enrichment/build-bundle';
import { runApifyModularPipeline } from '@/lib/enrichment/apify-pipeline';
import {
  getXaiModel,
  xaiResponsesWithWebSearch,
  type XaiUsageSummary,
} from '@/lib/xai/client';

const LEAN_LABELS: LeanLabel[] = ['Left', 'Right', 'Independent', 'Undetermined'];
const RESOLUTION_STATUSES: ResolutionStatus[] = ['probable', 'ambiguous', 'none'];

function parseMatches(raw: unknown): OsintMatch[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => ({
    platform: String(m?.platform ?? 'other'),
    url: String(m?.url ?? ''),
    match_score: clamp(Number(m?.match_score ?? 0), 0, 1),
    match_reasons: Array.isArray(m?.match_reasons) ? m.match_reasons.map(String) : [],
    signals: Array.isArray(m?.signals) ? m.signals.map(String) : [],
  }));
}

export function parseJsonFromModelText(text: string): GrokInferencePayload {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Model response did not contain JSON object');
  }

  const parsed = JSON.parse(candidate.slice(start, end + 1)) as Partial<GrokInferencePayload>;

  const identity_matches = parseMatches(
    parsed.identity_matches ?? parsed.matches ?? [],
  );

  const identity_resolution_status = RESOLUTION_STATUSES.includes(
    (parsed.identity_resolution_status ?? parsed.resolution_status) as ResolutionStatus,
  )
    ? ((parsed.identity_resolution_status ?? parsed.resolution_status) as ResolutionStatus)
    : 'none';

  const lean = LEAN_LABELS.includes(parsed.lean as LeanLabel)
    ? (parsed.lean as LeanLabel)
    : 'Undetermined';

  const lean_confidence = clamp(
    Math.round(Number(parsed.lean_confidence ?? parsed.confidence ?? 0)),
    0,
    100,
  );

  return {
    identity_resolution_status,
    identity_best_match_score: clamp(
      Number(parsed.identity_best_match_score ?? parsed.best_match_score ?? 0),
      0,
      1,
    ),
    identity_matches,
    lean,
    lean_confidence,
    lean_signals_found: Boolean(parsed.lean_signals_found),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
    search_summary: String(parsed.search_summary ?? ''),
  };
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function hasIdeologicalSignals(matches: OsintMatch[]): boolean {
  return matches.some((m) => m.signals.some((s) => s.trim().length > 0));
}

export function applyInferenceGuardrails(payload: GrokInferencePayload): GrokInferencePayload {
  const { identity_matches } = payload;
  let {
    identity_resolution_status,
    identity_best_match_score,
    lean,
    lean_confidence,
    lean_signals_found,
  } = payload;

  // Require quoted/public signals in identity_matches — do not trust lean_signals_found alone.
  const signalsFound = hasIdeologicalSignals(identity_matches);

  if (identity_matches.length > 0) {
    const topScore = Math.max(...identity_matches.map((m) => m.match_score), 0);
    identity_best_match_score = Math.max(identity_best_match_score, topScore);
  }

  if (identity_best_match_score >= 0.5 && identity_matches.length === 1) {
    identity_resolution_status = 'probable';
  } else if (identity_best_match_score >= 0.35 && identity_matches.length > 0) {
    if (identity_resolution_status === 'none') identity_resolution_status = 'probable';
  } else if (identity_matches.length > 1 && identity_best_match_score < 0.6) {
    identity_resolution_status = 'ambiguous';
  } else if (identity_matches.length === 0 && identity_best_match_score < 0.25) {
    identity_resolution_status = 'none';
  }

  if (!signalsFound) {
    lean = 'Undetermined';
    lean_confidence = Math.min(lean_confidence, 35);
    lean_signals_found = false;
  } else if (identity_resolution_status === 'ambiguous') {
    if (lean !== 'Independent') lean = 'Undetermined';
    lean_confidence = Math.min(lean_confidence, 45);
    lean_signals_found = true;
  } else {
    lean_signals_found = true;
  }

  return {
    ...payload,
    identity_resolution_status,
    identity_best_match_score: clamp(identity_best_match_score, 0, 1),
    identity_matches,
    lean,
    lean_confidence: clamp(lean_confidence, 0, 100),
    lean_signals_found,
  };
}

function toEnrichmentResult(
  payload: GrokInferencePayload,
  citations: string[],
  mode: EnrichmentMode,
  queryPlan: ReturnType<typeof buildSearchQueryPlan>,
): EnrichmentResult {
  return {
    resolution_status: payload.identity_resolution_status,
    identity_resolution_status: payload.identity_resolution_status,
    identity_best_match_score: payload.identity_best_match_score,
    identity_matches: payload.identity_matches,
    lean_signals_found: payload.lean_signals_found,
    matches: payload.identity_matches,
    best_match_score: payload.identity_best_match_score,
    search_summary: payload.search_summary,
    citations,
    search_queries: queryPlan.ordered,
    search_query_plan: queryPlan,
    pipeline_mode: mode,
  };
}

const SOCIAL_PLATFORMS = new Set(['x', 'twitter', 'linkedin', 'facebook', 'instagram', 'social']);

function matchedSocialUrls(matches: OsintMatch[]): string[] {
  return matches
    .filter((m) => m.url && SOCIAL_PLATFORMS.has(m.platform.toLowerCase()))
    .map((m) => (m.platform ? `${m.platform}: ${m.url}` : m.url));
}

export interface GrokPipelineDebug {
  prompt_system: string;
  prompt_user: string;
  raw_text: string;
  raw_response: unknown;
  parsed_before_guardrails: GrokInferencePayload;
  parsed_after_guardrails: GrokInferencePayload;
  usage: XaiUsageSummary | null;
  urls_searched: string[];
  pipeline_mode: EnrichmentMode;
}

export async function runEnrichmentPipeline(
  bundle: EnrichmentBundle,
  mode: EnrichmentMode = 'grok-full',
  options?: { includeDebug?: boolean },
): Promise<GrokPipelineResult & { debug?: GrokPipelineDebug }> {
  if (mode === 'apify-modular') {
    return runApifyModularPipeline(bundle, options);
  }

  const queryPlan = buildSearchQueryPlan(bundle);
  const systemPrompt = buildSystemPrompt(mode);
  const userPrompt = buildUserPrompt(bundle, mode);
  const model = getXaiModel();
  const enableSearchTools = mode !== 'modular-synthesize';

  const response = await xaiResponsesWithWebSearch({
    model,
    systemPrompt,
    userPrompt,
    enableWebSearch: enableSearchTools,
    enableXSearch: enableSearchTools,
  });

  const parsedRaw = parseJsonFromModelText(response.text);
  const parsed = applyInferenceGuardrails(parsedRaw);
  const enrichment = toEnrichmentResult(parsed, response.citations, mode, queryPlan);

  const auditSources =
    mode === 'modular-synthesize'
      ? ['Grok-Synthesize-Only', 'Email-Insights', 'Query-Planner', 'FL-Voting-History', 'FL-Voter-File']
      : mode === 'modular-targeted'
        ? ['Grok-Targeted-Search', 'x_search', 'Email-Insights', 'Query-Planner', 'FL-Voting-History', 'FL-Voter-File']
        : [
            'Grok-SocialFirst',
            'x_search',
            'web_search',
            'Donation-Activism-OSINT',
            'Local-Media-OSINT',
            'Civic-Professional-OSINT',
            'Email-Insights',
            'FL-Voting-History',
            'FL-Voter-File',
          ];

  const result: GrokPipelineResult = {
    enrichment,
    lean: parsed.lean,
    confidence: parsed.lean_confidence,
    evidence: parsed.evidence,
    matched_social: matchedSocialUrls(parsed.identity_matches),
    audit: {
      timestamp: new Date().toISOString(),
      sources: auditSources,
      model_version: model,
      ballot_favors: bundle.ballot_favors,
      pipeline_mode: mode,
      grok_raw_excerpt: response.text.slice(0, 2000),
      citations: response.citations,
    },
  };

  if (options?.includeDebug) {
    return {
      ...result,
      debug: {
        prompt_system: systemPrompt,
        prompt_user: userPrompt,
        raw_text: response.text,
        raw_response: response.raw,
        parsed_before_guardrails: parsedRaw,
        parsed_after_guardrails: parsed,
        usage: response.usage,
        urls_searched: response.citations,
        pipeline_mode: mode,
      },
    };
  }

  return result;
}

/** @deprecated use runEnrichmentPipeline */
export async function runGrokEnrichAndInfer(
  bundle: EnrichmentBundle,
  options?: { includeDebug?: boolean },
) {
  return runEnrichmentPipeline(bundle, 'grok-full', options);
}

export async function grokEnrichAndInferRecord(
  record: ParsedFlVoterRecord,
  historySummary: VoterHistorySummary | null | undefined,
  ballotFavors: BallotFavors,
  options?: { includeDebug?: boolean; mode?: EnrichmentMode },
) {
  const bundle = buildEnrichmentBundle(record, historySummary, ballotFavors);
  const result = await runEnrichmentPipeline(bundle, options?.mode ?? 'grok-full', options);
  return { ...result, bundle };
}