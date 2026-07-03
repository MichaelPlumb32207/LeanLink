const FEC_API_BASE = 'https://api.open.fec.gov/v1';

export interface FecContributionHit {
  receipt_date: string | null;
  amount: number | null;
  contributor_name: string | null;
  contributor_city: string | null;
  contributor_state: string | null;
  contributor_zip: string | null;
  contributor_employer: string | null;
  contributor_occupation: string | null;
  committee_name: string | null;
  candidate_name: string | null;
  fec_url: string | null;
}

export interface FecContributorLookupResult {
  query: {
    contributor_name: string;
    contributor_state: string;
    contributor_city: string | null;
    contributor_zip: string | null;
  };
  api_url: string;
  result_count: number;
  contributions: FecContributionHit[];
  error?: string;
}

function getFecApiKey(): string {
  return (
    process.env.FEC_API_KEY?.trim() ||
    process.env.FEC_OPEN_API_KEY?.trim() ||
    'DEMO_KEY'
  );
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}

function mapContribution(row: Record<string, unknown>): FecContributionHit {
  const committee = row.committee as Record<string, unknown> | undefined;
  const candidate = row.candidate as Record<string, unknown> | undefined;
  const subId = str(row.sub_id);

  return {
    receipt_date: str(row.contribution_receipt_date),
    amount: num(row.contribution_receipt_amount),
    contributor_name: str(row.contributor_name),
    contributor_city: str(row.contributor_city),
    contributor_state: str(row.contributor_state),
    contributor_zip: str(row.contributor_zip),
    contributor_employer: str(row.contributor_employer),
    contributor_occupation: str(row.contributor_occupation),
    committee_name: committee ? str(committee.name) : null,
    candidate_name: candidate ? str(candidate.name) : null,
    fec_url: subId ? `https://www.fec.gov/data/receipts/individual-contributions/?sub_id=${subId}` : null,
  };
}

/**
 * Direct FEC Open API lookup (Schedule A individual contributions).
 * Free with FEC_API_KEY; falls back to DEMO_KEY (strict rate limits).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FecMatchLevel = 'strict' | 'state_only';

export async function lookupFecContributions(params: {
  name: string;
  city?: string;
  state?: string;
  zip?: string;
  perPage?: number;
  matchLevel?: FecMatchLevel;
}): Promise<FecContributorLookupResult> {
  const contributor_name = params.name.trim();
  const contributor_state = (params.state?.trim() || 'FL').toUpperCase();
  const matchLevel = params.matchLevel ?? 'strict';
  const contributor_city = matchLevel === 'strict' ? params.city?.trim() || null : null;
  const contributor_zip =
    matchLevel === 'strict' ? params.zip?.trim().slice(0, 5) || null : null;
  const perPage = Math.min(Math.max(params.perPage ?? 20, 1), 100);

  const search = new URLSearchParams({
    api_key: getFecApiKey(),
    contributor_name,
    contributor_state,
    per_page: String(perPage),
    sort: '-contribution_receipt_date',
  });

  if (contributor_city) search.set('contributor_city', contributor_city);
  if (contributor_zip) search.set('contributor_zip', contributor_zip);

  const api_url = `${FEC_API_BASE}/schedules/schedule_a/?${search.toString()}`;

  try {
    // Retry transient failures: 429 (rate limit, long backoff) and 5xx / network
    // blips (FEC's gateway 502s intermittently — short backoff). Without this a
    // flaky 502 makes a real donor look like a non-donor with no second chance.
    const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);
    const MAX_ATTEMPTS = 4;
    let res: Response | null = null;
    let networkError: unknown = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        res = await fetch(api_url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      } catch (err) {
        networkError = err;
        res = null;
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(1_000 * (attempt + 1));
          continue;
        }
        break;
      }

      if (!RETRIABLE_STATUS.has(res.status)) break;
      if (attempt < MAX_ATTEMPTS - 1) {
        // 429 = rate limit (needs a long pause); 5xx = transient (recovers fast).
        await sleep(res.status === 429 ? 15_000 * (attempt + 1) : 1_000 * (attempt + 1));
      }
    }

    if (!res) {
      return {
        query: { contributor_name, contributor_state, contributor_city, contributor_zip },
        api_url,
        result_count: 0,
        contributions: [],
        error: `FEC API request failed: ${
          networkError instanceof Error ? networkError.message : 'no response'
        }`,
      };
    }

    if (!res.ok) {
      const text = await res.text();
      return {
        query: { contributor_name, contributor_state, contributor_city, contributor_zip },
        api_url,
        result_count: 0,
        contributions: [],
        error: `FEC API ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as {
      results?: Record<string, unknown>[];
      pagination?: { count?: number };
    };

    const contributions = (data.results ?? []).map(mapContribution);

    return {
      query: { contributor_name, contributor_state, contributor_city, contributor_zip },
      api_url,
      result_count: data.pagination?.count ?? contributions.length,
      contributions,
    };
  } catch (error) {
    return {
      query: { contributor_name, contributor_state, contributor_city, contributor_zip },
      api_url,
      result_count: 0,
      contributions: [],
      error: error instanceof Error ? error.message : 'FEC lookup failed',
    };
  }
}