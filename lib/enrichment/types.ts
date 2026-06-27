import type { BallotFavors } from '@/lib/fl-voter-history';

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

export interface ContactOnFile {
  has_email: boolean;
  has_phone: boolean;
  email?: string | null;
  phone?: string | null;
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
  resolution_status: ResolutionStatus;
  matches: OsintMatch[];
  best_match_score: number;
  search_summary: string;
  citations: string[];
}

export interface EnrichmentBundle {
  anchor: VoterAnchor;
  contact_on_file: ContactOnFile;
  history: HistoryContext;
  ballot_favors: BallotFavors;
}

export interface GrokInferencePayload {
  resolution_status: ResolutionStatus;
  best_match_score: number;
  matches: OsintMatch[];
  lean: LeanLabel;
  confidence: number;
  evidence: string[];
  search_summary: string;
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
    grok_raw_excerpt?: string;
    citations?: string[];
  };
}