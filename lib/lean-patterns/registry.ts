/**
 * DB loader for the lean-pattern registry (migration 019). Load once at a run
 * boundary (CLI startup, request start, FreePassContext) and thread through —
 * the scan functions themselves stay pure.
 */
import type { PoolClient } from 'pg';
import type { LeanLabel } from '@/lib/enrichment/types';
import {
  compileLeanPatternRows,
  getFallbackLeanPatterns,
  type LeanPatternRow,
  type LeanPatternScope,
  type LeanPatternSets,
} from '@/lib/lean-patterns/patterns';

export async function loadLeanPatterns(
  client: PoolClient,
  userId: string,
): Promise<LeanPatternSets> {
  try {
    const res = await client.query<{
      scope: LeanPatternScope;
      pattern: string;
      flags: string;
      lean: LeanLabel;
      confidence: number;
      label: string;
      sort_order: number;
    }>(
      `SELECT scope, pattern, flags, lean, confidence, label, sort_order
       FROM lean_patterns
       WHERE user_id = $1 AND enabled
       ORDER BY scope, sort_order`,
      [userId],
    );
    // Zero rows (different env / everything disabled) → fallback rather than
    // silently turning off all lean detection. Documented gotcha: you cannot
    // disable every pattern via enabled=false.
    if (res.rows.length === 0) return getFallbackLeanPatterns();
    return compileLeanPatternRows(res.rows as LeanPatternRow[], 'db');
  } catch (error) {
    // Pre-migration-019 degradation, same style as loadResearcherCommitteeLabels.
    if (error instanceof Error && /lean_patterns.*does not exist/i.test(error.message)) {
      return getFallbackLeanPatterns();
    }
    throw error;
  }
}
