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

/** One runner execution, normalized across arm_runs and fec_sweep_jobs. */
export interface ArmRunSummary {
  id: string;
  arm: string;
  runner: string; // 'fec_index_cli' | 'fec_index_api' | 'free_pass_api' | 'free_pass_cli' | 'fec_api_sweep'
  status: string;
  processed_count: number;
  total_count: number;
  failed_count: number;
  hits_count: number;
  confirmed_count: number;
  lean_signal_count: number;
  error_message: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  completed_at: string | null;
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
      /** Distinct voters with ≥1 event from this arm — the "attempted" column. */
      voters_touched: number;
      /** Distinct voters this arm identity-confirmed (probable_same_person). */
      voters_confirmed: number;
      /** Distinct voters with a non-Undetermined lean signal from this arm. */
      voters_with_lean: number;
      last_event_at: string | null;
    }
  >;
  fusion: {
    fused_count: number;
    provisional_count: number;
    conflicted_count: number;
    undetermined_count: number;
    by_lean: Record<string, number>;
  };
  settled: {
    by_tier: Record<string, number>; // "0".."3" → voters settled at that tier
    by_arm: Record<string, number>; // settled_arm ('party_prior','fec',…) → voters
    total: number;
  };
  review: {
    accepted_count: number; // researcher-accepted (frozen, out of all arms)
    re_enrolled_count: number; // settled but pushed back into later arms
  };
  waterfall: {
    /** Voters the next arm would actually claim (not settled/accepted, or re-enrolled). */
    eligible_remaining: number;
    /**
     * Waterfall before-state estimate: voters that flow INTO each tier — not accepted,
     * not settled at a cheaper tier (re-enrolled voters keep flowing). Slightly
     * approximate after re-enroll/re-run cycles; arm_runs (migration 014, Phase B)
     * records exact per-run pools.
     */
    eligible_by_tier: Record<string, number>; // "0".."3"
    /** Max spend if every eligible voter settles at that tier (null = unbilled upload). */
    projected: {
      tier1_usd: number;
      tier2_usd: number;
      tier3_usd: number;
      osint_attempts_usd: number;
    } | null;
  };
  billing: {
    account_id: string;
    baseline_usd: number;
    tier_usd: number;
    attempt_usd: number;
    total_usd: number;
  } | null;
  fec_sweep: {
    status: string | null;
    processed_count: number;
    total_count: number;
    raw_hits: number;
    confirmed_hits: number;
  } | null;
  /** Runner executions (arm_runs ∪ fec_sweep_jobs) — the current-inning feed. */
  runs: {
    active: ArmRunSummary[];
    /** Latest terminal run per arm. */
    recent: ArmRunSummary[];
  };
  /**
   * Researcher labeling opportunity: FL committees that neither the pattern
   * list nor a researcher label currently resolves, and how many eligible
   * (unsettled, unaccepted) voters could gain a fused lean from labeling them.
   * Computed live — labeling a committee shrinks both numbers on the next poll.
   */
  committees: {
    unlabeled_count: number;
    voters_affected: number;
  };
}