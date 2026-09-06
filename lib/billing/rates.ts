/**
 * Rate resolution for the leftover accounts ledger (not a product to sell).
 *
 * Values live in `rate_cards` (`scope='default'` plus optional per-account
 * overrides). NULL override fields fall back to default. Ledger rows snapshot
 * the amount at write time.
 */
import type { PoolClient } from 'pg';

export interface ResolvedRates {
  initiation: number;
  baseline: number;
  tier1: number;
  tier2: number;
  tier3: number;
  osintAttempt: number;
}

/** Last-resort fallback if the default row is missing. Software is free (MIT). */
const HARD_DEFAULTS: ResolvedRates = {
  initiation: 0,
  baseline: 0,
  tier1: 0,
  tier2: 0,
  tier3: 0,
  osintAttempt: 0,
};

interface RateRow {
  initiation_usd: string | null;
  baseline_usd: string | null;
  tier1_usd: string | null;
  tier2_usd: string | null;
  tier3_usd: string | null;
  osint_attempt_usd: string | null;
}

function num(value: string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

export async function resolveRates(
  client: PoolClient,
  accountId: string | null,
): Promise<ResolvedRates> {
  const scopes = accountId ? ['default', accountId] : ['default'];
  const { rows } = await client.query<RateRow & { scope: string }>(
    `SELECT scope, initiation_usd, baseline_usd, tier1_usd, tier2_usd, tier3_usd, osint_attempt_usd
     FROM rate_cards WHERE scope = ANY($1)`,
    [scopes],
  );

  const def = rows.find((r) => r.scope === 'default');
  const override = accountId ? rows.find((r) => r.scope === accountId) : undefined;

  const pick = (key: keyof RateRow, fallback: number): number =>
    num(override?.[key]) ?? num(def?.[key]) ?? fallback;

  return {
    initiation: pick('initiation_usd', HARD_DEFAULTS.initiation),
    baseline: pick('baseline_usd', HARD_DEFAULTS.baseline),
    tier1: pick('tier1_usd', HARD_DEFAULTS.tier1),
    tier2: pick('tier2_usd', HARD_DEFAULTS.tier2),
    tier3: pick('tier3_usd', HARD_DEFAULTS.tier3),
    osintAttempt: pick('osint_attempt_usd', HARD_DEFAULTS.osintAttempt),
  };
}

/** Success rate for a settlement tier (tier 0 = provided-party prior = free). */
export function tierRate(rates: ResolvedRates, tier: number): number {
  if (tier === 1) return rates.tier1;
  if (tier === 2) return rates.tier2;
  if (tier === 3) return rates.tier3;
  return 0;
}
