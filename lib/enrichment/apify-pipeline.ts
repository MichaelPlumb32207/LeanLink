import {
  flattenFetchText,
  organicUrlsFromGoogleItems,
  runGoogleSearchFetcher,
  runWebCrawlerFetcher,
  type ApifyActorRunSummary,
} from '@/lib/apify/fetchers';
import { apifyMaxCrawlUrls, apifyMaxSearchQueries } from '@/lib/apify/config';
import { buildSearchQueryPlan } from '@/lib/enrichment/query-builder';
import { buildSystemPrompt, buildUserPrompt } from '@/lib/enrichment/prompts';
import {
  applyInferenceGuardrails,
  parseJsonFromModelText,
  type GrokPipelineDebug,
} from '@/lib/enrichment/grok-pipeline';
import { runStreetViewVisionTest } from '@/lib/enrichment/street-view-vision';
import type {
  EnrichmentBundle,
  GrokPipelineResult,
  StreetViewContextSummary,
} from '@/lib/enrichment/types';
import type { SearchQueryPlan } from '@/lib/enrichment/query-builder';
import type { StreetViewVisionResult } from '@/lib/enrichment/street-view-vision';
import { getXaiModel, xaiResponsesWithWebSearch } from '@/lib/xai/client';

export interface ApifyPipelineStep {
  phase: 'A' | 'B' | 'C';
  label: string;
  status: 'ok' | 'skipped' | 'error' | 'partial';
  duration_ms: number | null;
  detail?: string;
}

export interface ApifyPipelineResult extends GrokPipelineResult {
  apify_runs: ApifyActorRunSummary[];
  street_view_context: StreetViewContextSummary | null;
  pipeline_steps: ApifyPipelineStep[];
  fetched_text_chars: number;
  debug?: GrokPipelineDebug & {
    apify_runs: ApifyActorRunSummary[];
    street_view_context: StreetViewContextSummary | null;
    pipeline_steps: ApifyPipelineStep[];
    fetched_text_excerpt: string;
  };
}

function apifySearchQueries(plan: SearchQueryPlan, max: number): string[] {
  const priority = [
    ...plan.social.slice(0, 2),
    ...plan.donations.slice(0, 1),
    ...plan.local_media.slice(0, 1),
    ...plan.civic_professional.slice(0, 1),
    ...plan.contact.slice(0, 1),
  ];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const q of priority) {
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
    if (out.length >= max) return out;
  }

  for (const q of plan.ordered) {
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
    if (out.length >= max) break;
  }

  return out;
}

function streetViewToContext(sv: StreetViewVisionResult): StreetViewContextSummary {
  return {
    status: sv.status,
    vision_mode: sv.vision_mode,
    address_used: sv.address_used,
    lean_street_view: sv.lean_street_view,
    lean_street_view_confidence: sv.lean_street_view_confidence,
    scene_summary: sv.scene_summary,
    visible_signals: sv.visible_signals,
    visible_cues: sv.visible_cues,
    inference_reasoning: sv.inference_reasoning,
    stereotype_factors_used: sv.stereotype_factors_used,
    imagery_quality: sv.imagery_quality,
    methodology_note: sv.methodology_note,
  };
}

function matchedSocialUrls(
  matches: { platform: string; url: string }[],
): string[] {
  const SOCIAL = new Set(['x', 'twitter', 'linkedin', 'facebook', 'instagram', 'social']);
  return matches
    .filter((m) => m.url && SOCIAL.has(m.platform.toLowerCase()))
    .map((m) => (m.platform ? `${m.platform}: ${m.url}` : m.url));
}

function urlsFromApifyRuns(runs: ApifyActorRunSummary[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    for (const url of run.queries_or_urls) {
      if (url.startsWith('http') && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

export async function runApifyModularPipeline(
  bundle: EnrichmentBundle,
  options?: { includeDebug?: boolean },
): Promise<ApifyPipelineResult> {
  const mode = 'apify-modular' as const;
  const queryPlan = buildSearchQueryPlan(bundle);
  const pipeline_steps: ApifyPipelineStep[] = [];
  const apify_runs: ApifyActorRunSummary[] = [];

  // Phase A — Street View (exploratory) + Google Search in parallel
  const searchQueries = apifySearchQueries(queryPlan, apifyMaxSearchQueries());

  const [streetViewResult, googleSearchRun] = await Promise.all([
    bundle.residence_on_file.has_usable_address
      ? runStreetViewVisionTest(bundle, 'exploratory')
      : Promise.resolve(null),
    runGoogleSearchFetcher(searchQueries),
  ]);

  apify_runs.push(googleSearchRun);

  const street_view_context = streetViewResult ? streetViewToContext(streetViewResult) : null;

  pipeline_steps.push({
    phase: 'A',
    label: 'Street View exploratory vision',
    status: streetViewResult
      ? streetViewResult.status === 'ok'
        ? 'ok'
        : 'partial'
      : bundle.residence_on_file.has_usable_address
        ? 'error'
        : 'skipped',
    duration_ms: streetViewResult ? null : null,
    detail: streetViewResult
      ? `${streetViewResult.status} · ${streetViewResult.lean_street_view} (${streetViewResult.lean_street_view_confidence}%)`
      : bundle.residence_on_file.has_usable_address
        ? 'No result'
        : 'No usable address on file',
  });

  pipeline_steps.push({
    phase: 'A',
    label: 'Apify Google Search',
    status:
      googleSearchRun.status === 'ok'
        ? 'ok'
        : googleSearchRun.status === 'skipped' || googleSearchRun.status === 'disabled'
          ? 'skipped'
          : 'error',
    duration_ms: googleSearchRun.duration_ms,
    detail: `${googleSearchRun.queries_or_urls.length} queries · ${googleSearchRun.item_count} items`,
  });

  // Phase B — crawl top organic URLs from search
  const crawlUrls = organicUrlsFromGoogleItems(
    googleSearchRun.items_preview as Record<string, unknown>[],
    apifyMaxCrawlUrls(),
  );

  const webCrawlerRun = await runWebCrawlerFetcher(crawlUrls);
  apify_runs.push(webCrawlerRun);

  pipeline_steps.push({
    phase: 'B',
    label: 'Apify Website Content Crawler',
    status:
      webCrawlerRun.status === 'ok'
        ? 'ok'
        : webCrawlerRun.status === 'skipped' || webCrawlerRun.status === 'disabled'
          ? 'skipped'
          : 'error',
    duration_ms: webCrawlerRun.duration_ms,
    detail: `${webCrawlerRun.queries_or_urls.length} URLs · ${webCrawlerRun.item_count} pages`,
  });

  const fetchedText = flattenFetchText(apify_runs);
  const fetched_text_chars = fetchedText.length;

  // Phase C — Grok synthesize only (no live search tools)
  const phaseCStarted = Date.now();
  const systemPrompt = buildSystemPrompt(mode);
  const userPrompt = buildUserPrompt(bundle, mode, {
    fetchedOsintText: fetchedText,
    streetViewContext: street_view_context,
  });
  const model = getXaiModel();

  const response = await xaiResponsesWithWebSearch({
    model,
    systemPrompt,
    userPrompt,
    enableWebSearch: false,
    enableXSearch: false,
  });

  const parsedRaw = parseJsonFromModelText(response.text);
  const parsed = applyInferenceGuardrails(parsedRaw);

  pipeline_steps.push({
    phase: 'C',
    label: 'Grok synthesize (no search tools)',
    status: 'ok',
    duration_ms: Date.now() - phaseCStarted,
    detail: `${fetched_text_chars} chars fetched OSINT + street view context`,
  });

  const citations = urlsFromApifyRuns(apify_runs);

  const enrichment = {
    resolution_status: parsed.identity_resolution_status,
    identity_resolution_status: parsed.identity_resolution_status,
    identity_best_match_score: parsed.identity_best_match_score,
    identity_matches: parsed.identity_matches,
    lean_signals_found: parsed.lean_signals_found,
    matches: parsed.identity_matches,
    best_match_score: parsed.identity_best_match_score,
    search_summary: parsed.search_summary,
    citations,
    search_queries: searchQueries,
    search_query_plan: queryPlan,
    pipeline_mode: mode,
  };

  const result: ApifyPipelineResult = {
    enrichment,
    lean: parsed.lean,
    confidence: parsed.lean_confidence,
    evidence: parsed.evidence,
    matched_social: matchedSocialUrls(parsed.identity_matches),
    apify_runs,
    street_view_context,
    pipeline_steps,
    fetched_text_chars,
    audit: {
      timestamp: new Date().toISOString(),
      sources: [
        'Apify-Google-Search',
        'Apify-Web-Crawler',
        'Grok-Synthesize-Only',
        'Street-View-Exploratory',
        'Email-Insights',
        'Query-Planner',
        'FL-Voting-History',
        'FL-Voter-File',
      ],
      model_version: model,
      ballot_favors: bundle.ballot_favors,
      pipeline_mode: mode,
      grok_raw_excerpt: response.text.slice(0, 2000),
      citations,
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
        urls_searched: citations,
        pipeline_mode: mode,
        apify_runs,
        street_view_context,
        pipeline_steps,
        fetched_text_excerpt: fetchedText.slice(0, 4000),
      },
    };
  }

  return result;
}