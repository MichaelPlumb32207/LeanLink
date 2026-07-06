import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import type { LeanLabel } from '@/lib/enrichment/types';
import {
  getFallbackLeanPatterns,
  scanLeanPatterns,
  type LeanPatternSets,
} from '@/lib/lean-patterns/patterns';

export interface CommitteeLeanSignal {
  lean: LeanLabel;
  confidence: number;
  reason: string;
  source: 'pattern' | 'researcher';
}

// Patterns live in the lean_patterns registry (migration 019) with
// lib/lean-patterns/patterns.ts as the single fallback source — never
// re-hardcode a list here (that fork is how DEF-005/006 happened).

export type ResearcherCommitteeLabel = {
  committee_name_norm: string;
  lean: LeanLabel;
  confidence: number;
  notes?: string | null;
};

export function inferLeanFromCommitteeName(
  committee: string | null | undefined,
  researcherLabels?: Map<string, ResearcherCommitteeLabel>,
  patterns?: LeanPatternSets,
): CommitteeLeanSignal | null {
  if (!committee?.trim()) return null;

  const norm = committeeNameNorm(committee);
  const researcher = researcherLabels?.get(norm);
  if (researcher && researcher.lean !== 'Undetermined') {
    return {
      lean: researcher.lean,
      confidence: researcher.confidence,
      reason: researcher.notes?.trim() || 'Researcher committee label',
      source: 'researcher',
    };
  }

  const match = scanLeanPatterns(committee, (patterns ?? getFallbackLeanPatterns()).fl);
  return match
    ? { lean: match.lean, confidence: match.confidence, reason: match.label, source: 'pattern' }
    : null;
}

export function unresolvedCommitteeNames(
  committees: string[],
  researcherLabels?: Map<string, ResearcherCommitteeLabel>,
  patterns?: LeanPatternSets,
): string[] {
  return committees.filter((c) => !inferLeanFromCommitteeName(c, researcherLabels, patterns));
}