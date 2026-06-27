/** Full-file lean inference is gated until enrichment cost/quality is validated per-voter. */
export function isBatchInferenceEnabled(): boolean {
  const raw = process.env.LEANLINK_ENABLE_BATCH_INFERENCE?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export const BATCH_INFERENCE_DISABLED_MESSAGE =
  'Full-file batch inference is disabled. Use per-voter enrichment tests (Test enrichment / scorecard) until LEANLINK_ENABLE_BATCH_INFERENCE is set.';