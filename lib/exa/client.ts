/**
 * Thin Exa REST client (no SDK).
 *
 * Deliberate non-xAI vendor for **retrieval only** — people index, web/news search,
 * and content extraction. Do not use for lean judgment; that stays on Grok
 * (`lib/xai/client.ts`) with `applyInferenceGuardrails`.
 *
 * Docs: https://exa.ai/docs/reference/search · last verified 2026-07-22
 */
import { exaDefaultNumResults, getExaApiKey } from '@/lib/exa/config';
import type {
  ExaCostDollars,
  ExaPersonProperties,
  ExaSearchOptions,
  ExaSearchResponse,
  ExaSearchResult,
  ExaWorkHistoryItem,
} from '@/lib/exa/types';

const EXA_BASE = 'https://api.exa.ai';

function parseCost(raw: unknown): ExaCostDollars {
  if (!raw || typeof raw !== 'object') return { total: null, raw };
  const total = (raw as { total?: unknown }).total;
  return {
    total: typeof total === 'number' && Number.isFinite(total) ? total : null,
    raw,
  };
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

function parseWorkHistory(raw: unknown): ExaWorkHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const company =
      o.company && typeof o.company === 'object'
        ? (o.company as Record<string, unknown>)
        : null;
    const dates =
      o.dates && typeof o.dates === 'object' ? (o.dates as Record<string, unknown>) : null;
    return {
      title: asString(o.title),
      location: asString(o.location),
      companyName: company ? asString(company.name) : null,
      from: dates ? asString(dates.from) : null,
      to: dates ? asString(dates.to) : null,
    };
  });
}

function parsePersonEntity(entities: unknown): ExaPersonProperties | null {
  if (!Array.isArray(entities)) return null;
  for (const ent of entities) {
    if (!ent || typeof ent !== 'object') continue;
    const e = ent as Record<string, unknown>;
    if (e.type !== 'person') continue;
    const props =
      e.properties && typeof e.properties === 'object'
        ? (e.properties as Record<string, unknown>)
        : {};
    const education = Array.isArray(props.educationHistory)
      ? props.educationHistory
          .map((ed) => {
            if (!ed || typeof ed !== 'object') return null;
            const o = ed as Record<string, unknown>;
            const inst =
              o.institution && typeof o.institution === 'object'
                ? asString((o.institution as { name?: unknown }).name)
                : null;
            const degree = asString(o.degree);
            return [degree, inst].filter(Boolean).join(' @ ') || null;
          })
          .filter((x): x is string => Boolean(x))
      : [];
    return {
      name: asString(props.name),
      firstName: asString(props.firstName),
      lastName: asString(props.lastName),
      location: asString(props.location),
      workHistory: parseWorkHistory(props.workHistory),
      educationSummary: education,
    };
  }
  return null;
}

function normalizeResult(raw: unknown): ExaSearchResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const url = asString(r.url);
  if (!url) return null;
  const highlights = Array.isArray(r.highlights)
    ? r.highlights.map(String).filter(Boolean)
    : [];
  return {
    id: asString(r.id),
    title: asString(r.title) ?? url,
    url,
    author: asString(r.author),
    publishedDate: asString(r.publishedDate),
    text: asString(r.text),
    highlights,
    summary: asString(r.summary),
    person: parsePersonEntity(r.entities),
  };
}

export async function exaSearch(options: ExaSearchOptions): Promise<ExaSearchResponse> {
  const apiKey = getExaApiKey();
  if (!apiKey) {
    throw new Error('EXA_API_KEY is not configured');
  }

  const numResults = options.numResults ?? exaDefaultNumResults();
  const body: Record<string, unknown> = {
    query: options.query,
    type: options.type ?? 'auto',
    numResults,
    userLocation: options.userLocation ?? 'US',
    contents: {
      highlights: options.highlights ?? true,
      ...(options.text
        ? {
            text:
              typeof options.text === 'object'
                ? { maxCharacters: options.text.maxCharacters ?? 2000 }
                : true,
          }
        : {}),
    },
  };

  if (options.category) body.category = options.category;
  // People/company categories reject domain filters (400).
  if (options.category !== 'people' && options.category !== 'company') {
    if (options.includeDomains?.length) body.includeDomains = options.includeDomains;
    if (options.excludeDomains?.length) body.excludeDomains = options.excludeDomains;
  }

  const started = Date.now();
  const response = await fetch(`${EXA_BASE}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const durationMs = Date.now() - started;
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const msg =
      typeof json.error === 'string'
        ? json.error
        : typeof (json as { message?: unknown }).message === 'string'
          ? String((json as { message: string }).message)
          : JSON.stringify(json).slice(0, 400);
    throw new Error(`Exa search ${response.status}: ${msg}`);
  }

  const results = Array.isArray(json.results)
    ? json.results.map(normalizeResult).filter((r): r is ExaSearchResult => Boolean(r))
    : [];

  return {
    requestId: asString(json.requestId),
    results,
    costDollars: parseCost(json.costDollars),
    durationMs,
    raw: json,
  };
}

export async function searchPeople(
  query: string,
  opts?: Omit<ExaSearchOptions, 'query' | 'category'>,
): Promise<ExaSearchResponse> {
  return exaSearch({
    query,
    category: 'people',
    type: opts?.type ?? 'auto',
    numResults: opts?.numResults,
    highlights: opts?.highlights ?? true,
    text: opts?.text,
    userLocation: opts?.userLocation ?? 'US',
  });
}

export async function searchWeb(
  query: string,
  opts?: Omit<ExaSearchOptions, 'query'>,
): Promise<ExaSearchResponse> {
  return exaSearch({
    query,
    category: opts?.category,
    type: opts?.type ?? 'auto',
    numResults: opts?.numResults,
    highlights: opts?.highlights ?? true,
    text: opts?.text,
    userLocation: opts?.userLocation ?? 'US',
    includeDomains: opts?.includeDomains,
    excludeDomains: opts?.excludeDomains,
  });
}

export interface ExaContentsOptions {
  urls: string[];
  maxCharacters?: number;
  highlights?: boolean;
}

export interface ExaContentsResponse {
  results: ExaSearchResult[];
  costDollars: ExaCostDollars;
  durationMs: number;
  raw: unknown;
}

/** Fetch clean page contents for known URLs (POST /contents). */
export async function fetchContents(options: ExaContentsOptions): Promise<ExaContentsResponse> {
  const apiKey = getExaApiKey();
  if (!apiKey) {
    throw new Error('EXA_API_KEY is not configured');
  }
  const urls = options.urls.map((u) => u.trim()).filter(Boolean).slice(0, 10);
  if (urls.length === 0) {
    return { results: [], costDollars: { total: null, raw: null }, durationMs: 0, raw: null };
  }

  const started = Date.now();
  const response = await fetch(`${EXA_BASE}/contents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      urls,
      text: { maxCharacters: options.maxCharacters ?? 3000 },
      highlights: options.highlights ?? true,
    }),
  });
  const durationMs = Date.now() - started;
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const msg =
      typeof json.error === 'string' ? json.error : JSON.stringify(json).slice(0, 400);
    throw new Error(`Exa contents ${response.status}: ${msg}`);
  }

  const results = Array.isArray(json.results)
    ? json.results.map(normalizeResult).filter((r): r is ExaSearchResult => Boolean(r))
    : [];

  return {
    results,
    costDollars: parseCost(json.costDollars),
    durationMs,
    raw: json,
  };
}
