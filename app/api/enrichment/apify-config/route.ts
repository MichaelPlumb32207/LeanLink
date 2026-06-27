import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import {
  APIFY_ACTOR_DEFINITIONS,
  getApifyApiToken,
  isActorEnabled,
  resolveActorId,
} from '@/lib/apify/config';

export async function GET() {
  try {
    await requireUser();

    const tokenConfigured = Boolean(getApifyApiToken());

    return NextResponse.json({
      token_configured: tokenConfigured,
      actors: APIFY_ACTOR_DEFINITIONS.map((def) => ({
        key: def.key,
        label: def.label,
        actor_id: resolveActorId(def),
        default_actor_id: def.defaultActorId,
        env_var: def.envVar,
        enabled_env_var: def.enabledEnvVar,
        enabled: isActorEnabled(def),
        description: def.description,
      })),
      limits: {
        max_search_queries: Number(process.env.APIFY_MAX_SEARCH_QUERIES ?? 5),
        max_crawl_urls: Number(process.env.APIFY_MAX_CRAWL_URLS ?? 2),
        run_timeout_sec: Number(process.env.APIFY_RUN_TIMEOUT_SEC ?? 120),
      },
      hint: tokenConfigured
        ? 'Override actors via APIFY_GOOGLE_SEARCH_ACTOR / APIFY_WEB_CRAWLER_ACTOR after testing.'
        : 'Add APIFY_API_TOKEN to Vercel env to run apify-modular fetches.',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : 'Failed to load Apify config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}