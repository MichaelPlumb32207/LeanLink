/** Throttle to stay under api.data.gov default 1,000 req/hour per FEC_API_KEY. */
export const FEC_REQUEST_INTERVAL_MS = (() => {
  const n = Number(process.env.FEC_REQUEST_INTERVAL_MS ?? 4000);
  return Number.isFinite(n) && n >= 1000 ? Math.min(Math.round(n), 60_000) : 4000;
})();

export const FEC_SWEEP_BATCH_SIZE = (() => {
  const n = Number(process.env.FEC_SWEEP_BATCH_SIZE ?? 120);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 200) : 120;
})();

export const FEC_SWEEP_MAX_DURATION_SEC = 800;
export const FEC_SWEEP_TIME_BUDGET_RATIO = 0.85;

export function getFecSweepDeadlineMs(): number {
  return Date.now() + FEC_SWEEP_MAX_DURATION_SEC * 1000 * FEC_SWEEP_TIME_BUDGET_RATIO;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}