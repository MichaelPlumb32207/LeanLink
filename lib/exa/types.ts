/** Exa search categories we use for OSINT retrieval. */
export type ExaCategory =
  | 'people'
  | 'news'
  | 'personal site'
  | 'company'
  | 'publication'
  | 'financial report';

export type ExaSearchType =
  | 'auto'
  | 'instant'
  | 'fast'
  | 'deep-lite'
  | 'deep'
  | 'deep-reasoning';

export interface ExaWorkHistoryItem {
  title: string | null;
  location: string | null;
  companyName: string | null;
  from: string | null;
  to: string | null;
}

export interface ExaPersonProperties {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  location: string | null;
  workHistory: ExaWorkHistoryItem[];
  educationSummary: string[];
}

export interface ExaSearchResult {
  id: string | null;
  title: string;
  url: string;
  author: string | null;
  publishedDate: string | null;
  text: string | null;
  highlights: string[];
  summary: string | null;
  /** Present on people/company category hits when Exa resolves an entity. */
  person: ExaPersonProperties | null;
}

export interface ExaCostDollars {
  total: number | null;
  raw: unknown;
}

export interface ExaSearchResponse {
  requestId: string | null;
  results: ExaSearchResult[];
  costDollars: ExaCostDollars;
  durationMs: number;
  raw: unknown;
}

export interface ExaSearchOptions {
  query: string;
  category?: ExaCategory;
  type?: ExaSearchType;
  numResults?: number;
  /** Prefer highlights for agent workflows (token-efficient). */
  highlights?: boolean;
  text?: boolean | { maxCharacters?: number };
  userLocation?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
}

/** Voter-side anchor used to score people candidates (no PII beyond name/geo). */
export interface ExaPeopleAnchor {
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName: string;
  city: string;
  countyLabel?: string;
  state?: string;
  /** Optional employer hint (e.g. Sunbiz-linked company). */
  employerHint?: string | null;
}

export interface ExaPeopleCandidate {
  url: string;
  title: string;
  name: string;
  location: string | null;
  matchScore: number;
  matchReasons: string[];
  workTitles: string[];
  companyNames: string[];
  highlights: string[];
  /** Raw Exa result retained for probes / evidence payloads. */
  source: ExaSearchResult;
}
