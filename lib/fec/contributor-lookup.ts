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
export async function lookupFecContributions(params: {
  name: string;
  city?: string;
  state?: string;
  zip?: string;
  perPage?: number;
}): Promise<FecContributorLookupResult> {
  const contributor_name = params.name.trim();
  const contributor_state = (params.state?.trim() || 'FL').toUpperCase();
  const contributor_city = params.city?.trim() || null;
  const contributor_zip = params.zip?.trim().slice(0, 5) || null;
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
    const res = await fetch(api_url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    });

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