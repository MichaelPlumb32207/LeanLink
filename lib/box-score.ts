/**
 * Box score — the engagement-level progress model behind the dashboard's
 * pinned scoreboard and per-arm line score (baseball metaphor: R/H/E header,
 * innings, current inning). Pure derivation from UploadEvidenceSummary so the
 * client and any future export share one set of numbers.
 */
import { EVIDENCE_ARMS } from '@/lib/evidence/arms';
import { ARM_TIER } from '@/lib/evidence/settlement';
import type { UploadEvidenceSummary } from '@/lib/evidence/types';

export type InningState = 'not_run' | 'partial' | 'complete' | 'live';

export interface BoxScoreInning {
  arm: string;
  label: string;
  tier: number;
  /** Waterfall before-state: voters flowing into this tier (estimate). */
  eligible_in: number;
  /** Voters run through per the arm run (processed_count), or distinct voters
   * with evidence when no run record exists ("processed so far"). */
  attempted: number;
  identity_hits: number;
  lean_signals: number;
  /** Voters whose waterfall settlement is attributed to this arm. */
  settled_here: number;
  last_event_at: string | null;
  state: InningState;
}

/**
 * "Runners on base" — cheap human actions that could convert into settles.
 * Data-driven so new opportunity types plug in beside the innings; the UI maps
 * `id` to an action (e.g. opening the committee-label manager).
 */
export interface BoxScoreOpportunity {
  id: 'label_committees' | 'refuse_committees';
  count: number;
  headline: string;
  detail: string;
  action_label: string;
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
  /** Scoring arms only — an inning is an at-bat (a chance to put a lean on the
   *  board): FEC, FL contributions, OSINT. Identity/context arms are NOT here. */
  innings: BoxScoreInning[];
  /** Identity-enrichment arms that feed an inning rather than scoring themselves
   *  (D-038). Sunbiz confirms officers → its leans book under FL contributions,
   *  so it renders nested inside that inning's panel, not as its own row. */
  enrichments: BoxScoreInning[];
  /** Non-tier arms with activity (household, researcher, …) — footnote line. */
  supporting: { arm: string; label: string; events: number; lean_signals: number }[];
  opportunities: BoxScoreOpportunity[];
}

const ARM_LABELS: Record<string, string> = Object.fromEntries(
  EVIDENCE_ARMS.map((a) => [a.id, a.label]),
);
ARM_LABELS.party_prior = 'Party (provided)';

/**
 * Innings = scoring arms (an at-bat can put a lean on the board), in waterfall
 * order (D-038). Party (T0) is pre-game context (emits no lean) and Sunbiz (T2)
 * is identity enrichment (structurally 0 leans — its runs book under FL
 * contributions), so neither is an inning.
 */
const CORE_INNINGS = ['fec', 'fl_contrib', 'osint'];
/** Tier arms shown only once they have events. */
const OPTIONAL_INNINGS = ['local_media', 'civic'];
/** Identity/context arms that never score — nested (Sunbiz) or footnoted, never innings. */
const ENRICHMENT_ARMS = ['sunbiz'];

export function buildBoxScore(summary: UploadEvidenceSummary): BoxScore {
  const labeled_count = summary.fusion.fused_count + summary.fusion.provisional_count;
  const liveArms = new Set((summary.runs?.active ?? []).map((r) => r.arm));
  if (summary.fec_sweep?.status === 'running' || summary.fec_sweep?.status === 'queued') {
    liveArms.add('fec');
  }
  const activeRunByArm = new Map((summary.runs?.active ?? []).map((r) => [r.arm, r]));
  const recentRunByArm = new Map((summary.runs?.recent ?? []).map((r) => [r.arm, r]));

  const inningFor = (arm: string): BoxScoreInning => {
    const tier = ARM_TIER[arm] ?? 3;
    const stats = summary.arms[arm];
    const eligible_in = summary.waterfall.eligible_by_tier[String(tier)] ?? 0;
    const settled_here = summary.settled.by_arm[arm] ?? 0;
    // "Processed" = the fullest coverage we can show: the run's voters-run-through
    // (right for hit-only arms like Sunbiz, whose event count undercounts) vs the
    // cumulative event-touched count (right for no-hit arms run in segments, where
    // the last run's processed_count undercounts). max() picks the better of the two.
    const run = activeRunByArm.get(arm) ?? recentRunByArm.get(arm);
    const attempted = Math.max(run?.processed_count ?? 0, stats?.voters_touched ?? 0);
    // STATE is the arm's run lifecycle — a completed run is COMPLETE even when a
    // hit-only arm (Sunbiz) produced far fewer events than eligible voters.
    // PARTIAL is reserved for genuinely interrupted runs (cancelled/failed).
    let state: InningState = 'not_run';
    if (liveArms.has(arm)) {
      state = 'live';
    } else {
      const recent = recentRunByArm.get(arm);
      if (recent) {
        state = recent.status === 'completed' ? 'complete' : 'partial';
      } else if (attempted > 0 || settled_here > 0) {
        state = attempted >= eligible_in ? 'complete' : 'partial';
      }
    }
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

  // Enrichment arms (Sunbiz) — always nested inside their host inning's panel so
  // the action surface stays reachable on a fresh upload (not_run is fine; zero
  // stats are fine). Never a scoring row. Activity only changes the numbers/state.
  const enrichments = ENRICHMENT_ARMS.map(inningFor);

  // party_prior is pre-game context, not a row or a footnote; enrichments are
  // nested; everything else with events is a supporting footnote.
  const accountedArms = new Set([
    ...CORE_INNINGS,
    ...OPTIONAL_INNINGS,
    ...ENRICHMENT_ARMS,
    'party_prior',
  ]);
  const supporting = Object.entries(summary.arms)
    .filter(([arm, stats]) => !accountedArms.has(arm) && stats.event_count > 0)
    .map(([arm, stats]) => ({
      arm,
      label: ARM_LABELS[arm] ?? arm,
      events: stats.event_count,
      lean_signals: stats.lean_signal_count,
    }))
    .sort((a, b) => b.lean_signals - a.lean_signals || b.events - a.events);

  const opportunities: BoxScoreOpportunity[] = [];
  if ((summary.committees?.pending_refusion_voters ?? 0) > 0) {
    opportunities.push({
      id: 'refuse_committees',
      count: summary.committees.pending_refusion_voters,
      headline: `${summary.committees.pending_refusion_voters.toLocaleString()} voters behind labeled committees await re-fusion`,
      detail: `${summary.committees.pending_refusion_committees.toLocaleString()} committee${summary.committees.pending_refusion_committees === 1 ? '' : 's'} labeled but not yet applied — one click books the leans`,
      action_label: 'Re-fuse now',
    });
  }
  if ((summary.committees?.unlabeled_count ?? 0) > 0) {
    opportunities.push({
      id: 'label_committees',
      count: summary.committees.voters_affected,
      headline: `${summary.committees.unlabeled_count.toLocaleString()} committees have no lean label`,
      detail: `${summary.committees.voters_affected.toLocaleString()} still-eligible voters could gain a fused lean`,
      action_label: 'Label committees',
    });
  }

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
    enrichments,
    supporting,
    opportunities,
  };
}
