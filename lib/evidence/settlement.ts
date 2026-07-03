/**
 * Waterfall settlement.
 *
 * Once an arm produces a confident lean for a voter, that voter is "settled" at
 * the tier of the cheapest contributing arm and is excluded from later (more
 * expensive) arms. This is what turns the pipeline into a true cost-saving
 * waterfall and gives billing a clean per-tier attribution.
 *
 * Tiers: 0 = provided-party prior (free/unbilled), 1 = FEC, 2 = FL contrib /
 * Sunbiz, 3 = OSINT / local media / civic. Undetermined never settles.
 */
import type { FusionResult } from '@/lib/evidence/types';

/** Confidence a lean must clear to settle (and stop paying for more research). */
export const SETTLE_THRESHOLD = Number(process.env.LEANLINK_SETTLE_THRESHOLD ?? 60);

/** Arm → billing/waterfall tier. Cheapest arm that got us there wins. */
export const ARM_TIER: Record<string, number> = {
  party_prior: 0,
  fec: 1,
  fl_contrib: 2,
  sunbiz: 2,
  osint: 3,
  local_media: 3,
  civic: 3,
};

export interface Settlement {
  arm: string;
  tier: number;
}

/** Tier of the cheapest (lowest-tier) contributing arm, or null if none map. */
export function settlementTier(arms: string[]): number | null {
  const tiers = arms.map((a) => ARM_TIER[a]).filter((t) => t !== undefined);
  return tiers.length ? Math.min(...tiers) : null;
}

/**
 * Decide whether a fused result settles the voter, and at which tier/arm.
 * Returns null when the voter should fall through to the next arm.
 *
 * Fusion only assigns a non-Undetermined lean when identity is confirmed/probable
 * (see `fuseEvidenceEvents`), so the confidence check carries the identity gate.
 */
export function computeSettlement(fusion: FusionResult): Settlement | null {
  if (fusion.lean === 'Undetermined') return null;
  if (fusion.confidence < SETTLE_THRESHOLD) return null;
  const tier = settlementTier(fusion.contributing_arms);
  if (tier === null) return null;
  const arm = fusion.contributing_arms.find((a) => ARM_TIER[a] === tier) ?? fusion.contributing_arms[0];
  return { arm, tier };
}
