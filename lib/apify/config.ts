export interface ApifyActorDefinition {
  key: string;
  label: string;
  /** Apify store ID, e.g. apify/google-search-scraper */
  defaultActorId: string;
  envVar: string;
  enabledEnvVar: string;
  description: string;
}

export const APIFY_ACTOR_DEFINITIONS: ApifyActorDefinition[] = [
  {
    key: 'google_search',
    label: 'Google Search',
    defaultActorId: 'apify/google-search-scraper',
    envVar: 'APIFY_GOOGLE_SEARCH_ACTOR',
    enabledEnvVar: 'APIFY_ENABLE_GOOGLE_SEARCH',
    description: 'Runs query-plan Google queries (social, Tier-A, directory).',
  },
  {
    key: 'web_crawler',
    label: 'Website Content Crawler',
    defaultActorId: 'apify/website-content-crawler',
    envVar: 'APIFY_WEB_CRAWLER_ACTOR',
    enabledEnvVar: 'APIFY_ENABLE_WEB_CRAWLER',
    description: 'Fetches top organic URLs from search results (1 page each).',
  },
];

export function getApifyApiToken(): string | null {
  const token = process.env.APIFY_API_TOKEN?.trim();
  return token || null;
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return defaultValue;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function resolveActorId(def: ApifyActorDefinition): string {
  return process.env[def.envVar]?.trim() || def.defaultActorId;
}

export function isActorEnabled(def: ApifyActorDefinition): boolean {
  const defaults: Record<string, boolean> = {
    google_search: true,
    web_crawler: true,
  };
  return envFlag(def.enabledEnvVar, defaults[def.key] ?? false);
}

export function apifyMaxSearchQueries(): number {
  const n = Number(process.env.APIFY_MAX_SEARCH_QUERIES ?? 5);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 12) : 5;
}

export function apifyMaxCrawlUrls(): number {
  const n = Number(process.env.APIFY_MAX_CRAWL_URLS ?? 2);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 5) : 2;
}

export function apifyRunTimeoutSec(): number {
  const n = Number(process.env.APIFY_RUN_TIMEOUT_SEC ?? 120);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 300) : 120;
}

/** Actor ID for URL path: apify/google-search-scraper → apify~google-search-scraper */
export function actorIdToPath(actorId: string): string {
  return actorId.includes('/') ? actorId.replace('/', '~') : actorId;
}