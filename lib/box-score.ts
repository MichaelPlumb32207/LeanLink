/**
 * Box score — the engagement-level progress model behind the dashboard's
 * pinned scoreboard and per-arm line score (baseball metaphor: R/H/E header,
 * innings, current inning). Pure derivation from UploadEvidenceSummary so the
 * client and any future export share one set of numbers.
 */
import { EVIDENCE_ARMS } from '@/lib/evidence/arms';
import { ARM_TIER } from '@/lib/evidence/settlement';
import type { UploadEvidenceSummary } from '@/lib/evidence/types';

export type InningState = 'not_run' | 'partial' | 'run' | 'live';

export interface BoxScoreInning {
  arm: string;
  label: string;
  tier: number;
  /** Waterfall before-state: voters flowing into this tier (estimate). */
  eligible_in: number;
  /** Distinct voters this arm has produced evidence for ("processed so far"). */
  attempted: number;
  identity_hits: number;
  lean_signals: number;
  /** Voters whose waterfall settlement is attributed to this arm. */
  settled_here: number;
  last_event_at: string | null;
  state: InningState;
}

export interface BoxScore {
  scoreboard: {
    records_in: number;
    leans_settled: number;
    conflicted: number;
    accepted: number;
    eligible_remaining: number;
    labeled_count: number;
    labeled_pct: number;
    by_lean: Record<string, number>;
    billing_total_usd: number | null;
  };
  innings: BoxScoreInning[];
  /** Non-tier arms with activity (household, researcher, …) — footnote line. */
  supporting: { arm: string; label: string; events: number; lean_signals: number }[];
}

const ARM_LABELS: Record<string, string> = Object.fromEntries(
  EVIDENCE_ARMS.map((a) => [a.id, a.label]),
);
ARM_LABELS.party_prior = 'Party (provided)';

/** Tier arms always shown, in waterfall order. */
const CORE_INNINGS = ['party_prior', 'fec', 'fl_contrib', 'sunbiz', 'osint'];
/** Tier arms shown only once they have events. */
const OPTIONAL_INNINGS = ['local_media', 'civic'];

export function buildBoxScore(summary: UploadEvidenceSummary): BoxScore {
  const labeled_count = summary.fusion.fused_count + summary.fusion.provisional_count;
  const liveArms = new Set((summary.runs?.active ?? []).map((r) => r.arm));
  if (summary.fec_sweep?.status === 'running' || summary.fec_sweep?.status === 'queued') {
    liveArms.add('fec');
  }

  const inningFor = (arm: string): BoxScoreInning => {
    const tier = ARM_TIER[arm] ?? 3;
    const stats = summary.arms[arm];
    const eligible_in = summary.waterfall.eligible_by_tier[String(tier)] ?? 0;
    const attempted = stats?.voters_touched ?? 0;
    const settled_here = summary.settled.by_arm[arm] ?? 0;
    let state: InningState = 'not_run';
    if (liveArms.has(arm)) state = 'live';
    else if (attempted >= eligible_in && (attempted > 0 || settled_here > 0)) state = 'run';
    else if (attempted > 0 || settled_here > 0) state = 'partial';
    return {
      arm,
      label: ARM_LABELS[arm] ?? arm,
      tier,
      eligible_in,
      attempted,
      identity_hits: stats?.voters_confirmed ?? 0,
      lean_signals: stats?.voters_with_lean ?? 0,
      settled_here,
      last_event_at: stats?.last_event_at ?? null,
      state,
    };
  };

  const innings = [
    ...CORE_INNINGS,
    ...OPTIONAL_INNINGS.filter((arm) => (summary.arms[arm]?.event_count ?? 0) > 0),
  ]
    .map(inningFor)
    .sort((a, b) => a.tier - b.tier);

  const tierArms = new Set([...CORE_INNINGS, ...OPTIONAL_INNINGS]);
  const supporting = Object.entries(summary.arms)
    .filter(([arm, stats]) => !tierArms.has(arm) && stats.event_count > 0)
    .map(([arm, stats]) => ({
      arm,
      label: ARM_LABELS[arm] ?? arm,
      events: stats.event_count,
      lean_signals: stats.lean_signal_count,
    }))
    .sort((a, b) => b.lean_signals - a.lean_signals || b.events - a.events);

  return {
    scoreboard: {
      records_in: summary.voter_count,
      leans_settled: summary.settled.total,
      conflicted: summary.fusion.conflicted_count,
      accepted: summary.review.accepted_count,
      eligible_remaining: summary.waterfall.eligible_remaining,
      labeled_count,
      labeled_pct:
        summary.voter_count > 0
          ? Math.round((labeled_count / summary.voter_count) * 1000) / 10
          : 0,
      by_lean: summary.fusion.by_lean,
      billing_total_usd: summary.billing?.total_usd ?? null,
    },
    innings,
    supporting,
  };
}
