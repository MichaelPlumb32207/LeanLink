/**
 * Funnel baselines + anomaly detection for arm runs (ENH-006). Priors are this
 * user's prior COMPLETED runs of the same arm across all uploads — county
 * demographics vary, so the bands are deliberately coarse: flag only when a
 * rate falls below ⅓× or above 3× the median of priors, and only once both the
 * current run and each prior have processed ≥ 1,000 voters. Computed at read
 * time while a run is active; nothing is persisted.
 */
import type { PoolClient } from 'pg';

/** Both the current run and priors must clear this for stable rates. */
export const ANOMALY_MIN_PROCESSED = 1000;
const RATIO_HIGH = 3;
const RATIO_LOW = 1 / 3;

export interface PriorRunRow {
  arm: string;
  runner: string;
  processed_count: number;
  hits_count: number;
  confirmed_count: number;
  /** NULL for fec_sweep_jobs priors — their normalized lean count is structural, not measured. */
  lean_signal_count: number | null;
}

export interface CurrentRunCounts {
  arm: string;
  processed_count: number;
  hits_count: number;
  confirmed_count: number;
  lean_signal_count: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(rate >= 0.1 ? 0 : 1)}%`;
}

export function computeRunAnomalies(
  current: CurrentRunCounts,
  priors: PriorRunRow[],
): string[] {
  if (current.processed_count < ANOMALY_MIN_PROCESSED) return [];
  const eligible = priors.filter(
    (p) => p.arm === current.arm && p.processed_count >= ANOMALY_MIN_PROCESSED,
  );
  if (eligible.length === 0) return [];

  const anomalies: string[] = [];
  const check = (
    name: string,
    currentRate: number,
    priorRates: number[],
    priorCount: number,
  ) => {
    const med = median(priorRates);
    if (med == null || med === 0) return;
    const ratio = currentRate / med;
    if (ratio < RATIO_LOW || ratio > RATIO_HIGH) {
      anomalies.push(
        `${name} ${pct(currentRate)} vs typical ${pct(med)} (median of ${priorCount} prior ${current.arm} run${priorCount === 1 ? '' : 's'}) — source drift?`,
      );
    }
  };

  check(
    'hit rate',
    current.hits_count / current.processed_count,
    eligible.map((p) => p.hits_count / p.processed_count),
    eligible.length,
  );
  check(
    'confirmed rate',
    current.confirmed_count / current.processed_count,
    eligible.map((p) => p.confirmed_count / p.processed_count),
    eligible.length,
  );
  const leanPriors = eligible.filter((p) => p.lean_signal_count !== null);
  if (leanPriors.length > 0) {
    check(
      'lean rate',
      current.lean_signal_count / current.processed_count,
      leanPriors.map((p) => (p.lean_signal_count as number) / p.processed_count),
      leanPriors.length,
    );
  }

  return anomalies;
}

/** Priors per arm for this user — arm_runs ∪ completed fec_sweep_jobs. */
export async function loadPriorRunRates(
  client: PoolClient,
  userId: string,
  arms: string[],
): Promise<Map<string, PriorRunRow[]>> {
  const { rows } = await client.query<PriorRunRow>(
    `SELECT arm, runner, processed_count, hits_count, confirmed_count, lean_signal_count
     FROM (
       SELECT arm, runner, processed_count, hits_count, confirmed_count, lean_signal_count
       FROM arm_runs
       WHERE user_id = $1 AND status = 'completed' AND processed_count >= ${ANOMALY_MIN_PROCESSED}
       UNION ALL
       SELECT 'fec', 'fec_api_sweep', processed_count, hits_count,
              COALESCE(confirmed_hits_count, 0), NULL::integer
       FROM fec_sweep_jobs
       WHERE user_id = $1 AND status = 'completed' AND processed_count >= ${ANOMALY_MIN_PROCESSED}
     ) p
     WHERE p.arm = ANY($2)`,
    [userId, arms],
  );
  const byArm = new Map<string, PriorRunRow[]>();
  for (const row of rows) {
    const list = byArm.get(row.arm) ?? [];
    list.push(row);
    byArm.set(row.arm, list);
  }
  return byArm;
}
