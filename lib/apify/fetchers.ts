import {
  APIFY_ACTOR_DEFINITIONS,
  apifyMaxCrawlUrls,
  apifyMaxSearchQueries,
  isActorEnabled,
  resolveActorId,
} from '@/lib/apify/config';
import { runActorSyncGetDatasetItems } from '@/lib/apify/client';

export interface ApifyActorRunSummary {
  actor_key: string;
  actor_id: string;
  label: string;
  status: 'ok' | 'skipped' | 'error' | 'disabled';
  queries_or_urls: string[];
  item_count: number;
  duration_ms: number | null;
  error_message?: string;
  /** Truncated items for audit JSON */
  items_preview: unknown[];
}

const SKIP_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'webcache.googleusercontent.com',
  'accounts.google.com',
]);

function truncateText(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function extractUrl(item: Record<string, unknown>): string | null {
  const candidates = [item.url, item.link, item.pageUrl, item.loadedUrl];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('http')) return c;
  }
  return null;
}

function extractSnippet(item: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ['title', 'description', 'snippet', 'text', 'pageTitle', 'metaDescription']) {
    const v = item[key];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  return parts.join(' — ');
}

export function organicUrlsFromGoogleItems(
  items: Record<string, unknown>[],
  limit: number,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const organic = item.organicResults;
    const rows = Array.isArray(organic) ? organic : [item];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const url = extractUrl(r);
      if (!url || seen.has(url)) continue;
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        if (SKIP_HOSTS.has(host) || host.endsWith('.google.com')) continue;
      } catch {
        continue;
      }
      seen.add(url);
      urls.push(url);
      if (urls.length >= limit) return urls;
    }
  }

  return urls;
}

export function flattenFetchText(
  runs: ApifyActorRunSummary[],
  maxChars = 24_000,
): string {
  const chunks: string[] = [];

  for (const run of runs) {
    if (run.status !== 'ok' || run.items_preview.length === 0) continue;
    chunks.push(`## ${run.label} (${run.actor_id})`);
    if (run.queries_or_urls.length > 0) {
      chunks.push(`Queries/URLs: ${run.queries_or_urls.join(' | ')}`);
    }
    for (const [i, item] of run.items_preview.entries()) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const url = extractUrl(row);
      const snippet = extractSnippet(row);
      chunks.push(
        `[${i + 1}] ${url ?? '(no url)'}${snippet ? `\n${snippet}` : ''}`,
      );
      const body = row.text ?? row.markdown ?? row.content;
      if (typeof body === 'string' && body.trim()) {
        chunks.push(truncateText(body.trim(), 2000));
      }
    }
    chunks.push('');
  }

  return truncateText(chunks.join('\n'), maxChars);
}

function defByKey(key: string) {
  const def = APIFY_ACTOR_DEFINITIONS.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown Apify actor key: ${key}`);
  return def;
}

export async function runGoogleSearchFetcher(
  queries: string[],
): Promise<ApifyActorRunSummary> {
  const def = defByKey('google_search');
  const actorId = resolveActorId(def);

  if (!isActorEnabled(def)) {
    return {
      actor_key: def.key,
      actor_id: actorId,
      label: def.label,
      status: 'disabled',
      queries_or_urls: queries,
      item_count: 0,
      duration_ms: null,
      items_preview: [],
    };
  }

  const limited = queries.slice(0, apifyMaxSearchQueries());
  if (limited.length === 0) {
    return {
      actor_key: def.key,
      actor_id: actorId,
      label: def.label,
      status: 'skipped',
      queries_or_urls: [],
      item_count: 0,
      duration_ms: null,
      error_message: 'No queries provided',
      items_preview: [],
    };
  }

  const result = await runActorSyncGetDatasetItems<Record<string, unknown>>(actorId, {
    queries: limited.join('\n'),
    maxPagesPerQuery: 1,
    resultsPerPage: 10,
    mobileResults: false,
    languageCode: 'en',
    countryCode: 'us',
  });

  if (result.status === 'error') {
    return {
      actor_key: def.key,
      actor_id: actorId,
      label: def.label,
      status: 'error',
      queries_or_urls: limited,
      item_count: 0,
      duration_ms: result.duration_ms,
      error_message: result.error_message,
      items_preview: [],
    };
  }

  return {
    actor_key: def.key,
    actor_id: actorId,
    label: def.label,
    status: 'ok',
    queries_or_urls: limited,
    item_count: result.item_count,
    duration_ms: result.duration_ms,
    items_preview: result.items.slice(0, 15),
  };
}

export async function runWebCrawlerFetcher(
  urls: string[],
): Promise<ApifyActorRunSummary> {
  const def = defByKey('web_crawler');
  const actorId = resolveActorId(def);

  if (!isActorEnabled(def)) {
    return {
      actor_key: def.key,
      actor_id: actorId,
      label: def.label,
      status: 'disabled',
      queries_or_urls: urls,
      item_count: 0,
      duration_ms: null,
      items_preview: [],
    };
  }

  const limited = urls.slice(0, apifyMaxCrawlUrls());
  if (limited.length === 0) {
    return {
      actor_key: def.key,
      actor_id: actorId,
      label: def.label,
      status: 'skipped',
      queries_or_urls: [],
      item_count: 0,
      duration_ms: null,
      items_preview: [],
    };
  }

  const result = await runActorSyncGetDatasetItems<Record<string, unknown>>(actorId, {
    startUrls: limited.map((url) => ({ url })),
    maxCrawlPages: limited.length,
    maxCrawlDepth: 0,
    saveMarkdown: true,
  });

  if (result.status === 'error') {
    return {
      actor_key: def.key,
      actor_id: actorId,
      label: def.label,
      status: 'error',
      queries_or_urls: limited,
      item_count: 0,
      duration_ms: result.duration_ms,
      error_message: result.error_message,
      items_preview: [],
    };
  }

  return {
    actor_key: def.key,
    actor_id: actorId,
    label: def.label,
    status: 'ok',
    queries_or_urls: limited,
    item_count: result.item_count,
    duration_ms: result.duration_ms,
    items_preview: result.items.slice(0, limited.length),
  };
}

export function listConfiguredActors(): ApifyActorRunSummary[] {
  return APIFY_ACTOR_DEFINITIONS.map((def) => ({
    actor_key: def.key,
    actor_id: resolveActorId(def),
    label: def.label,
    status: isActorEnabled(def) ? 'skipped' : 'disabled',
    queries_or_urls: [],
    item_count: 0,
    duration_ms: null,
    items_preview: [],
  }));
}