import {
  actorIdToPath,
  apifyRunTimeoutSec,
  getApifyApiToken,
} from '@/lib/apify/config';

export interface ApifyRunResult<T = Record<string, unknown>> {
  actor_id: string;
  status: 'ok' | 'error';
  item_count: number;
  items: T[];
  duration_ms: number;
  error_message?: string;
}

export async function runActorSyncGetDatasetItems<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
): Promise<ApifyRunResult<T>> {
  const token = getApifyApiToken();
  if (!token) {
    throw new Error('APIFY_API_TOKEN is not configured');
  }

  const started = Date.now();
  const pathId = actorIdToPath(actorId);
  const timeout = apifyRunTimeoutSec();

  const url = new URL(
    `https://api.apify.com/v2/acts/${pathId}/run-sync-get-dataset-items`,
  );
  url.searchParams.set('timeout', String(timeout));
  url.searchParams.set('memory', '1024');

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const duration_ms = Date.now() - started;

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      actor_id: actorId,
      status: 'error',
      item_count: 0,
      items: [],
      duration_ms,
      error_message: `Apify ${response.status}: ${detail.slice(0, 500)}`,
    };
  }

  const items = (await response.json()) as T[];
  return {
    actor_id: actorId,
    status: 'ok',
    item_count: Array.isArray(items) ? items.length : 0,
    items: Array.isArray(items) ? items : [],
    duration_ms,
  };
}