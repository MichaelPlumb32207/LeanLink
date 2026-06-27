import { buildEnrichmentBundle } from '@/lib/enrichment/build-bundle';
import type {
  EnrichmentBundle,
  EnrichmentResult,
  GrokInferencePayload,
  GrokPipelineResult,
  LeanLabel,
  ResolutionStatus,
} from '@/lib/enrichment/types';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';
import type { BallotFavors, VoterHistorySummary } from '@/lib/fl-voter-history';
import {
  getXaiModel,
  xaiResponsesWithWebSearch,
  type XaiUsageSummary,
} from '@/lib/xai/client';

const LEAN_LABELS: LeanLabel[] = ['Left', 'Right', 'Independent', 'Undetermined'];
const RESOLUTION_STATUSES: ResolutionStatus[] = ['probable', 'ambiguous', 'none'];

const SYSTEM_PROMPT = `You are LeanLink, a research-only political intelligence assistant for Florida NPA (No Party Affiliation) voters.

Your task uses live web search (OSINT) to find PUBLIC online personas matching a voter anchor, then infer political lean from public signals only.

STRICT RULES:
- OSINT only: public web, social profiles, news. No commercial data brokers.
- NEVER use race, gender, or demographic stereotypes.
- Do NOT use precinct/district geographic priors for lean (geo signals are disabled).
- Voter is NPA — party registration is not available.
- Voting history primary participation indicates engagement level ONLY, not party lean.
- If no credible public match: lean MUST be "Undetermined", confidence MUST be <= 35.
- If multiple ambiguous matches: lean "Undetermined" or "Independent", confidence <= 45.
- Cite only public evidence in evidence[].
- Return ONLY valid JSON matching the schema — no markdown fences.`;

function buildUserPrompt(bundle: EnrichmentBundle): string {
  return `Research this Florida NPA voter using web search, then infer lean.

VOTER ANCHOR (public record):
${JSON.stringify(bundle.anchor, null, 2)}

CONTACT ON FILE (may help disambiguate; do not invent contact not found):
${JSON.stringify(
  {
    has_email: bundle.contact_on_file.has_email,
    has_phone: bundle.contact_on_file.has_phone,
  },
  null,
  2,
)}

VOTING HISTORY (behavioral — NOT ideological; primary count is engagement only):
${JSON.stringify(bundle.history, null, 2)}

BALLOT SCENARIO (for context only; do not output opposition score):
ballot_favors: ${bundle.ballot_favors}

Search for public online presence (social, LinkedIn, X, public Facebook, local news, etc.) matching this person in Florida.

Return JSON:
{
  "resolution_status": "probable" | "ambiguous" | "none",
  "best_match_score": 0.0 to 1.0,
  "matches": [
    {
      "platform": "x|linkedin|facebook|web|other",
      "url": "https://...",
      "match_score": 0.0 to 1.0,
      "match_reasons": ["..."],
      "signals": ["ideological signals from public content"]
    }
  ],
  "lean": "Left" | "Right" | "Independent" | "Undetermined",
  "confidence": 0 to 100,
  "evidence": ["human-readable evidence strings"],
  "search_summary": "brief description of what you searched and found"
}`;
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

  const lean = LEAN_LABELS.includes(parsed.lean as LeanLabel)
    ? (parsed.lean as LeanLabel)
    : 'Undetermined';

  const resolution_status = RESOLUTION_STATUSES.includes(parsed.resolution_status as ResolutionStatus)
    ? (parsed.resolution_status as ResolutionStatus)
    : 'none';

  return {
    resolution_status,
    best_match_score: clamp(Number(parsed.best_match_score ?? 0), 0, 1),
    matches: Array.isArray(parsed.matches)
      ? parsed.matches.map((m) => ({
          platform: String(m?.platform ?? 'other'),
          url: String(m?.url ?? ''),
          match_score: clamp(Number(m?.match_score ?? 0), 0, 1),
          match_reasons: Array.isArray(m?.match_reasons)
            ? m.match_reasons.map(String)
            : [],
          signals: Array.isArray(m?.signals) ? m.signals.map(String) : [],
        }))
      : [],
    lean,
    confidence: clamp(Math.round(Number(parsed.confidence ?? 0)), 0, 100),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
    search_summary: String(parsed.search_summary ?? ''),
  };
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function applyInferenceGuardrails(payload: GrokInferencePayload): GrokInferencePayload {
  let { lean, confidence, resolution_status, best_match_score } = payload;

  if (resolution_status === 'none' || best_match_score < 0.25 || payload.matches.length === 0) {
    lean = 'Undetermined';
    confidence = Math.min(confidence, 35);
    resolution_status = 'none';
  } else if (resolution_status === 'ambiguous') {
    if (lean !== 'Independent') lean = 'Undetermined';
    confidence = Math.min(confidence, 45);
  }

  confidence = clamp(confidence, 0, 100);
  best_match_score = clamp(best_match_score, 0, 1);

  return { ...payload, lean, confidence, resolution_status, best_match_score };
}

function toEnrichmentResult(
  payload: GrokInferencePayload,
  citations: string[],
): EnrichmentResult {
  return {
    resolution_status: payload.resolution_status,
    matches: payload.matches,
    best_match_score: payload.best_match_score,
    search_summary: payload.search_summary,
    citations,
  };
}

function matchedSocialUrls(matches: GrokInferencePayload['matches']): string[] {
  return matches
    .filter((m) => m.url)
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
}

export async function runGrokEnrichAndInfer(
  bundle: EnrichmentBundle,
  options?: { includeDebug?: boolean },
): Promise<GrokPipelineResult & { debug?: GrokPipelineDebug }> {
  const userPrompt = buildUserPrompt(bundle);
  const model = getXaiModel();

  const response = await xaiResponsesWithWebSearch({
    model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    enableWebSearch: true,
  });

  const parsedRaw = parseJsonFromModelText(response.text);
  const parsed = applyInferenceGuardrails(parsedRaw);
  const enrichment = toEnrichmentResult(parsed, response.citations);

  const result: GrokPipelineResult = {
    enrichment,
    lean: parsed.lean,
    confidence: parsed.confidence,
    evidence: parsed.evidence,
    matched_social: matchedSocialUrls(parsed.matches),
    audit: {
      timestamp: new Date().toISOString(),
      sources: ['Grok-LiveSearch', 'FL-Voting-History', 'FL-Voter-File'],
      model_version: model,
      ballot_favors: bundle.ballot_favors,
      grok_raw_excerpt: response.text.slice(0, 2000),
      citations: response.citations,
    },
  };

  if (options?.includeDebug) {
    return {
      ...result,
      debug: {
        prompt_system: SYSTEM_PROMPT,
        prompt_user: userPrompt,
        raw_text: response.text,
        raw_response: response.raw,
        parsed_before_guardrails: parsedRaw,
        parsed_after_guardrails: parsed,
        usage: response.usage,
        urls_searched: response.citations,
      },
    };
  }

  return result;
}

export async function grokEnrichAndInferRecord(
  record: ParsedFlVoterRecord,
  historySummary: VoterHistorySummary | null | undefined,
  ballotFavors: BallotFavors,
  options?: { includeDebug?: boolean },
): Promise<GrokPipelineResult & { debug?: GrokPipelineDebug; bundle: EnrichmentBundle }> {
  const bundle = buildEnrichmentBundle(record, historySummary, ballotFavors);
  const result = await runGrokEnrichAndInfer(bundle, options);
  return { ...result, bundle };
}