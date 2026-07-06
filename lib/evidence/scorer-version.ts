/**
 * Version of the lean-scoring logic, stamped into evidence payloads as
 * `scorer_v` so re-passes can target stale events precisely
 * (`payload->>'scorer_v' IS NULL OR (payload->>'scorer_v')::int < N`).
 *
 * v1 — implicit: everything written before the pattern registry existed
 *      (hardcoded lists, pre-2026-07-06). Payloads without the key are v1.
 * v2 — pattern registry (migration 019) + itemized receipts + party-code fixes
 *      (D-030, DEF-005/006).
 *
 * Bump this when scoring behavior changes in a way that makes prior events
 * worth re-scoring.
 */
export const SCORER_VERSION = 2;
