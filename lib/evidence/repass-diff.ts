/**
 * Re-pass diff (ENH-010) — the "before/after" half of re-pass-as-a-product-op.
 *
 * A re-pass (run-fec-index / run-free-pass with current logic) already
 * supersedes stale events (DEF-009's `deleteVoterArmEvents`) and re-fuses. What
 * it didn't tell you was *what changed*. This module captures a per-voter
 * snapshot of the deliverable-relevant fusion state for an upload, and diffs two
 * snapshots into a settles-gained / leans-changed / why report.
 *
 * Deliberately decoupled from the re-pass itself: the operator brackets a run
 * with `snapshot` (before) and `report` (after), so it works for any arm and at
 * county scale without holding a run open. Pure functions here; the CLI
 * (scripts/repass-diff.ts) does the I/O. No migration — reads voter_lean_fusion.
 */
import type { PoolClient } from 'pg';

export type Lean = 'Left' | 'Right' | 'Independent' | 'Undetermined';

/** One voter's deliverable-relevant state at a point in time. */
export interface VoterFusionState {
  voter_record_id: string;
  row_index: number | null;
  lean: Lean;
  confidence: number;
  fusion_status: string;
  settled_tier: number | null;
  settled_arm: string | null;
  review_status: string | null;
  /** Sorted arm ids contributing to the fused lean, joined by '+' for cheap compare. */
  arms: string;
}

export interface RepassSnapshot {
  upload_id: string;
  captured_at: string;
  scorer_v: number;
  voter_count: number;
  voters: VoterFusionState[];
}

/** Capture the current fusion state for every voter in an upload. */
export async function captureRepassSnapshot(
  client: PoolClient,
  uploadId: string,
  scorerVersion: number,
  capturedAt: string,
): Promise<RepassSnapshot> {
  const { rows } = await client.query<{
    voter_record_id: string;
    row_index: number | null;
    lean: Lean;
    confidence: number;
    fusion_status: string;
    settled_tier: number | null;
    settled_arm: string | null;
    review_status: string | null;
    contributing_arms: unknown;
  }>(
    `SELECT f.voter_record_id,
            vr.row_index,
            f.lean,
            f.confidence,
            f.fusion_status,
            f.settled_tier,
            f.settled_arm,
            f.review_status,
            f.contributing_arms
     FROM voter_lean_fusion f
     JOIN voter_records vr ON vr.id = f.voter_record_id
     WHERE f.upload_id = $1`,
    [uploadId],
  );

  const voters: VoterFusionState[] = rows.map((r) => ({
    voter_record_id: r.voter_record_id,
    row_index: r.row_index,
    lean: r.lean,
    confidence: r.confidence,
    fusion_status: r.fusion_status,
    settled_tier: r.settled_tier,
    settled_arm: r.settled_arm,
    review_status: r.review_status,
    arms: normalizeArms(r.contributing_arms),
  }));

  return {
    upload_id: uploadId,
    captured_at: capturedAt,
    scorer_v: scorerVersion,
    voter_count: voters.length,
    voters,
  };
}

/** contributing_arms JSONB → sorted, de-duped 'arm+arm' string for comparison. */
function normalizeArms(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  const ids = new Set<string>();
  for (const a of raw) {
    if (typeof a === 'string') ids.add(a);
    else if (a && typeof a === 'object' && 'arm' in a && typeof (a as { arm: unknown }).arm === 'string') {
      ids.add((a as { arm: string }).arm);
    }
  }
  return [...ids].sort().join('+');
}

export interface LeanChange {
  voter_record_id: string;
  row_index: number | null;
  from: Lean;
  to: Lean;
  from_confidence: number;
  to_confidence: number;
  from_arm: string | null;
  to_arm: string | null;
}

export interface RepassDiff {
  upload_id: string;
  before_captured_at: string;
  after_captured_at: string;
  before_scorer_v: number;
  after_scorer_v: number;
  // Population deltas
  in_both: number;
  only_before: number; // voters present before, gone after (deleted upload rows — rare)
  only_after: number; // new fusion rows since baseline
  // Settlement
  settled_before: number;
  settled_after: number;
  settles_gained: number; // was unsettled → now settled
  settles_lost: number; // was settled → now unsettled
  settle_tier_changed: number;
  settled_by_arm_after: Record<string, number>;
  // Lean direction
  leans_gained: number; // Undetermined → partisan (Left/Right/Independent)
  leans_lost: number; // partisan → Undetermined
  leans_flipped: number; // Left↔Right (any partisan → different partisan)
  net_partisan_before: number;
  net_partisan_after: number;
  // Confidence (voters whose lean direction is unchanged and partisan)
  confidence_up: number;
  confidence_down: number;
  net_confidence_delta: number;
  // Attribution / why
  arm_set_changed: number; // contributing arm set differs
  frozen_skipped: number; // review_status='accepted' either side — never touched
  // Sample of the most consequential changes (settles + flips first)
  notable: LeanChange[];
}

const PARTISAN: ReadonlySet<Lean> = new Set<Lean>(['Left', 'Right', 'Independent']);
const isPartisan = (l: Lean) => PARTISAN.has(l);

/** Diff two snapshots of the same upload. Order-independent (keyed by voter id). */
export function diffRepassSnapshots(
  before: RepassSnapshot,
  after: RepassSnapshot,
  notableLimit = 50,
): RepassDiff {
  const beforeById = new Map(before.voters.map((v) => [v.voter_record_id, v]));
  const afterById = new Map(after.voters.map((v) => [v.voter_record_id, v]));

  const diff: RepassDiff = {
    upload_id: after.upload_id,
    before_captured_at: before.captured_at,
    after_captured_at: after.captured_at,
    before_scorer_v: before.scorer_v,
    after_scorer_v: after.scorer_v,
    in_both: 0,
    only_before: 0,
    only_after: 0,
    settled_before: 0,
    settled_after: 0,
    settles_gained: 0,
    settles_lost: 0,
    settle_tier_changed: 0,
    settled_by_arm_after: {},
    leans_gained: 0,
    leans_lost: 0,
    leans_flipped: 0,
    net_partisan_before: 0,
    net_partisan_after: 0,
    confidence_up: 0,
    confidence_down: 0,
    net_confidence_delta: 0,
    arm_set_changed: 0,
    frozen_skipped: 0,
    notable: [],
  };

  for (const v of before.voters) if (v.settled_tier != null) diff.settled_before += 1;
  for (const v of after.voters) {
    if (v.settled_tier != null) {
      diff.settled_after += 1;
      const arm = v.settled_arm ?? 'unknown';
      diff.settled_by_arm_after[arm] = (diff.settled_by_arm_after[arm] ?? 0) + 1;
    }
    if (v.review_status === 'accepted' || beforeById.get(v.voter_record_id)?.review_status === 'accepted') {
      diff.frozen_skipped += 1;
    }
    if (!beforeById.has(v.voter_record_id)) diff.only_after += 1;
  }
  for (const v of before.voters) if (!afterById.has(v.voter_record_id)) diff.only_before += 1;

  const scored: { change: LeanChange; sev: number }[] = [];

  for (const b of before.voters) {
    const a = afterById.get(b.voter_record_id);
    if (!a) continue;
    diff.in_both += 1;

    // Settlement transitions
    const wasSettled = b.settled_tier != null;
    const isSettled = a.settled_tier != null;
    if (!wasSettled && isSettled) diff.settles_gained += 1;
    else if (wasSettled && !isSettled) diff.settles_lost += 1;
    else if (wasSettled && isSettled && b.settled_tier !== a.settled_tier) diff.settle_tier_changed += 1;

    // Lean direction
    const partisanBefore = isPartisan(b.lean);
    const partisanAfter = isPartisan(a.lean);
    if (partisanBefore) diff.net_partisan_before += 1;
    if (partisanAfter) diff.net_partisan_after += 1;

    let severity = 0; // rank for the notable sample
    if (!partisanBefore && partisanAfter) {
      diff.leans_gained += 1;
      severity = 3;
    } else if (partisanBefore && !partisanAfter) {
      diff.leans_lost += 1;
      severity = 3;
    } else if (partisanBefore && partisanAfter && b.lean !== a.lean) {
      diff.leans_flipped += 1;
      severity = 4; // a flip is the loudest change
    } else if (partisanBefore && partisanAfter && b.lean === a.lean) {
      // same partisan direction — confidence movement only
      if (a.confidence > b.confidence) diff.confidence_up += 1;
      else if (a.confidence < b.confidence) diff.confidence_down += 1;
      diff.net_confidence_delta += a.confidence - b.confidence;
    }
    if (severity === 0 && !wasSettled && isSettled) severity = 3;
    if (severity === 0 && b.arms !== a.arms) severity = 1;

    if (b.arms !== a.arms) diff.arm_set_changed += 1;

    if (severity > 0) {
      scored.push({
        sev: severity,
        change: {
          voter_record_id: b.voter_record_id,
          row_index: a.row_index ?? b.row_index,
          from: b.lean,
          to: a.lean,
          from_confidence: b.confidence,
          to_confidence: a.confidence,
          from_arm: b.settled_arm,
          to_arm: a.settled_arm,
        },
      });
    }
  }

  scored.sort(
    (x, y) =>
      y.sev - x.sev ||
      Math.abs(y.change.to_confidence - y.change.from_confidence) -
        Math.abs(x.change.to_confidence - x.change.from_confidence),
  );
  diff.notable = scored.slice(0, notableLimit).map((s) => s.change);

  return diff;
}

function pct(n: number, d: number): string {
  if (d === 0) return '0%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

/** Human-readable markdown for the CLI / a future deliverable-delta attachment. */
export function formatRepassDiffMarkdown(diff: RepassDiff): string {
  const L: string[] = [];
  L.push(`# Re-pass diff — upload \`${diff.upload_id}\``);
  L.push('');
  L.push(
    `Baseline ${diff.before_captured_at} (scorer_v ${diff.before_scorer_v}) → ` +
      `after ${diff.after_captured_at} (scorer_v ${diff.after_scorer_v})`,
  );
  L.push('');
  L.push('## Population');
  L.push(`- Voters compared (in both): **${diff.in_both.toLocaleString()}**`);
  if (diff.only_after) L.push(`- New fusion rows since baseline: ${diff.only_after.toLocaleString()}`);
  if (diff.only_before) L.push(`- Rows gone since baseline: ${diff.only_before.toLocaleString()}`);
  if (diff.frozen_skipped) L.push(`- Frozen (accepted, never re-scored): ${diff.frozen_skipped.toLocaleString()}`);
  L.push('');
  L.push('## Settles');
  L.push(
    `- ${diff.settled_before.toLocaleString()} → **${diff.settled_after.toLocaleString()}** ` +
      `(net ${signed(diff.settled_after - diff.settled_before)})`,
  );
  L.push(`- Gained: **+${diff.settles_gained.toLocaleString()}** · Lost: ${diff.settles_lost.toLocaleString()} · Tier changed: ${diff.settle_tier_changed.toLocaleString()}`);
  const byArm = Object.entries(diff.settled_by_arm_after).sort((a, b) => b[1] - a[1]);
  if (byArm.length) L.push(`- Settled by arm (after): ${byArm.map(([a, n]) => `${a} ${n.toLocaleString()}`).join(' · ')}`);
  L.push('');
  L.push('## Leans');
  L.push(`- Partisan (Left/Right/Ind): ${diff.net_partisan_before.toLocaleString()} → **${diff.net_partisan_after.toLocaleString()}** (net ${signed(diff.net_partisan_after - diff.net_partisan_before)})`);
  L.push(`- New leans (Undetermined→partisan): **+${diff.leans_gained.toLocaleString()}**`);
  L.push(`- Lost leans (partisan→Undetermined): ${diff.leans_lost.toLocaleString()}`);
  L.push(`- Flipped direction (L↔R): ${diff.leans_flipped.toLocaleString()}`);
  L.push('');
  L.push('## Confidence (same-direction voters)');
  L.push(`- Up: ${diff.confidence_up.toLocaleString()} · Down: ${diff.confidence_down.toLocaleString()} · Net Δ: ${signed(diff.net_confidence_delta)} pts`);
  L.push(`- Contributing-arm set changed: ${diff.arm_set_changed.toLocaleString()} voters`);
  L.push('');
  if (diff.notable.length) {
    L.push(`## Notable changes (top ${diff.notable.length})`);
    L.push('');
    L.push('| Row | From | To | Conf | Settled arm |');
    L.push('|---|---|---|---|---|');
    for (const c of diff.notable) {
      const conf = c.from_confidence === c.to_confidence ? `${c.to_confidence}` : `${c.from_confidence}→${c.to_confidence}`;
      const arm = c.from_arm === c.to_arm ? (c.to_arm ?? '—') : `${c.from_arm ?? '—'}→${c.to_arm ?? '—'}`;
      L.push(`| ${c.row_index ?? '—'} | ${c.from} | ${c.to} | ${conf} | ${arm} |`);
    }
    L.push('');
  }
  L.push(
    `_Yield: ${diff.settles_gained} new settles across ${diff.in_both.toLocaleString()} voters (${pct(diff.settles_gained, diff.in_both)})._`,
  );
  return L.join('\n');
}

function signed(n: number): string {
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}
