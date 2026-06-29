import type { AnchorProfile } from '@/lib/anchor/profile';
import type { BallotFavors } from '@/lib/fl-voter-history';
import type { EnrichmentMode } from '@/lib/enrichment/modes';
import type { EmailInsights } from '@/lib/enrichment/email-insights';

export type { EmailInsights };

export type LeanLabel = 'Left' | 'Right' | 'Independent' | 'Undetermined';

export type ResolutionStatus = 'probable' | 'ambiguous' | 'none';

export interface VoterAnchor {
  voter_id: string;
  name_full: string;
  city: string;
  zip: string;
  precinct: string;
  county_code: string;
}

export interface ResidenceOnFile {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  full: string;
  has_usable_address: boolean;
}

export interface ContactOnFile {
  has_email: boolean;
  has_phone: boolean;
  email?: string | null;
  phone?: string | null;
  phone_raw?: string | null;
  phone_search_variants?: string[];
}

export interface SearchQueryPlanSummary {
  social: string[];
  contact: string[];
  donations: string[];
  local_media: string[];
  civic_professional: string[];
  directory: string[];
  ordered: string[];
}

export interface HistoryContext {
  turnout_propensity: string;
  turnout_score: number;
  primary_engagement: string;
  primary_count: number;
  general_elections_voted: number;
  general_elections_available: number;
  last_vote_date: string | null;
}

export interface OsintMatch {
  platform: string;
  url: string;
  match_score: number;
  match_reasons: string[];
  signals: string[];
}

export interface EnrichmentResult {
  /** @deprecated use identity_resolution_status */
  resolution_status: ResolutionStatus;
  identity_resolution_status: ResolutionStatus;
  identity_best_match_score: number;
  identity_matches: OsintMatch[];
  lean_signals_found: boolean;
  /** @deprecated use identity_matches */
  matches: OsintMatch[];
  /** @deprecated use identity_best_match_score */
  best_match_score: number;
  search_summary: string;
  citations: string[];
  search_queries: string[];
  search_query_plan?: SearchQueryPlanSummary;
  pipeline_mode: EnrichmentMode;
}

export interface EnrichmentBundle {
  anchor: VoterAnchor;
  residence_on_file: ResidenceOnFile;
  contact_on_file: ContactOnFile;
  email_insights: EmailInsights;
  /** File-grounded name variants + co-residents — widens queries, not global identity. */
  anchor_profile: AnchorProfile;
  history: HistoryContext;
  ballot_favors: BallotFavors;
}

export interface GrokInferencePayload {
  identity_resolution_status: ResolutionStatus;
  identity_best_match_score: number;
  identity_matches: OsintMatch[];
  lean: LeanLabel;
  lean_confidence: number;
  lean_signals_found: boolean;
  evidence: string[];
  search_summary: string;
  /** legacy fields from older prompts */
  resolution_status?: ResolutionStatus;
  best_match_score?: number;
  matches?: OsintMatch[];
  confidence?: number;
}

export interface StreetViewContextSummary {
  status: 'ok' | 'no_imagery' | 'no_address' | 'api_unconfigured' | 'google_unconfigured' | 'error';
  vision_mode: 'strict' | 'exploratory';
  address_used: string | null;
  lean_street_view: LeanLabel;
  lean_street_view_confidence: number;
  scene_summary: string;
  visible_signals: string[];
  visible_cues?: string[];
  inference_reasoning?: string[];
  stereotype_factors_used?: string[];
  imagery_quality: 'clear' | 'partial' | 'obstructed' | 'none';
  methodology_note: string;
}

export interface GrokPipelineResult {
  enrichment: EnrichmentResult;
  lean: LeanLabel;
  confidence: number;
  evidence: string[];
  matched_social: string[];
  audit: {
    timestamp: string;
    sources: string[];
    model_version: string;
    ballot_favors: BallotFavors;
    pipeline_mode: EnrichmentMode;
    grok_raw_excerpt?: string;
    citations?: string[];
  };
}