import type { LeanLabel } from '@/lib/enrichment/types';
import type { FecIdentityBand } from '@/lib/fec/identity-match';

export type EvidenceArmId =
  | 'fec'
  | 'fl_contrib'
  | 'sunbiz'
  | 'osint'
  | 'local_media'
  | 'civic'
  | 'household'
  | 'street_view'
  | 'human_judgment'
  | 'turnout';

export type FusionStatus = 'undetermined' | 'provisional' | 'fused' | 'conflicted';

export interface EvidenceEventInput {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  arm: EvidenceArmId;
  source: string;
  identity_band?: FecIdentityBand | null;
  identity_score?: number | null;
  probable_same_person?: boolean;
  lean_signal?: LeanLabel | null;
  lean_confidence?: number | null;
  evidence?: string[];
  urls?: string[];
  payload?: Record<string, unknown> | null;
  cost_usd?: number | null;
  dedupe_key?: string;
}

export interface EvidenceEventRow {
  id: string;
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  arm: EvidenceArmId;
  source: string;
  identity_band: FecIdentityBand | null;
  identity_score: number | null;
  probable_same_person: boolean;
  lean_signal: LeanLabel | null;
  lean_confidence: number | null;
  evidence: string[];
  urls: string[];
  payload: Record<string, unknown> | null;
  cost_usd: number | null;
  created_at: string;
}

export interface FusionResult {
  lean: LeanLabel;
  confidence: number;
  fusion_status: FusionStatus;
  contributing_arms: EvidenceArmId[];
  evidence_summary: string[];
  event_count: number;
}

export interface UploadEvidenceSummary {
  upload_id: string;
  voter_count: number;
  arms: Record<
    string,
    {
      event_count: number;
      probable_match_count: number;
      lean_signal_count: number;
      total_cost_usd: number;
    }
  >;
  fusion: {
    fused_count: number;
    provisional_count: number;
    conflicted_count: number;
    undetermined_count: number;
    by_lean: Record<string, number>;
  };
  fec_sweep: {
    status: string | null;
    processed_count: number;
    raw_hits: number;
    confirmed_hits: number;
  } | null;
}