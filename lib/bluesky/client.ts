/**
 * Bluesky public AppView client (read-only, NO AUTH).
 *
 * The AT Protocol makes the whole social graph public by design — follows,
 * reposts, likes, and profiles are readable without an account via the
 * unauthenticated AppView at public.api.bsky.app. That's what makes a Bluesky
 * follow-graph a *legitimate* OSINT lean signal (public by the user's own
 * choice, official API, no scraping, no fake accounts) — unlike gated Meta
 * properties. See docs/CLAUDE.md (ENH-017).
 *
 * Coverage caveat: Bluesky is small and skews tech/activist/left, so ordinary
 * FL voters may simply not be on it. Measure coverage before trusting the arm.
 */
const APPVIEW = 'https://public.api.bsky.app/xrpc';

export interface BskyActor {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
}

export interface BskyProfile extends BskyActor {
  followsCount?: number;
  followersCount?: number;
  postsCount?: number;
}

async function get<T>(method: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const res = await fetch(`${APPVIEW}/${method}?${qs}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Bluesky ${method} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Fuzzy actor search by name/handle. Returns candidates — NOT identity-verified. */
export async function searchActors(query: string, limit = 15): Promise<BskyActor[]> {
  const data = await get<{ actors: BskyActor[] }>('app.bsky.actor.searchActors', {
    q: query,
    limit,
  });
  return data.actors ?? [];
}

/** Full profile (incl. follow counts) for a handle or DID, or null if not found. */
export async function getProfile(actor: string): Promise<BskyProfile | null> {
  try {
    return await get<BskyProfile>('app.bsky.actor.getProfile', { actor });
  } catch {
    return null;
  }
}

/** All accounts an actor follows (paginated; capped at `max`). */
export async function getFollows(actor: string, max = 500): Promise<BskyActor[]> {
  const out: BskyActor[] = [];
  let cursor: string | undefined;
  while (out.length < max) {
    const page: { follows: BskyActor[]; cursor?: string } = await get(
      'app.bsky.graph.getFollows',
      cursor ? { actor, limit: 100, cursor } : { actor, limit: 100 },
    );
    out.push(...(page.follows ?? []));
    if (!page.cursor || (page.follows?.length ?? 0) === 0) break;
    cursor = page.cursor;
  }
  return out.slice(0, max);
}

/** Polite pause between calls — the public AppView is rate-limited. */
export function bskyDelay(ms = 150): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
