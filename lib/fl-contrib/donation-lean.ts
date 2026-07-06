import {
  inferLeanFromCommitteeName,
  type ResearcherCommitteeLabel,
} from '@/lib/committee-lean/infer';
import type { LeanLabel } from '@/lib/enrichment/types';
import type { LeanPatternSets } from '@/lib/lean-patterns/patterns';
import type { FlContributionHit } from '@/lib/fl-contrib/types';

export interface FlDonationLeanResult {
  lean: LeanLabel;
  confidence: number;
  lean_signals_found: boolean;
  evidence: string[];
}

export function inferLeanFromFlContributions(
  hits: FlContributionHit[],
  context?: {
    layer?: 1 | 2;
    entity_name?: string;
    researcher_labels?: Map<string, ResearcherCommitteeLabel>;
    patterns?: LeanPatternSets;
  },
): FlDonationLeanResult {
  const evidence: string[] = [];
  let best: { lean: LeanLabel; confidence: number } | null = null;

  for (const hit of hits) {
    const signal = inferLeanFromCommitteeName(
      hit.committee_name,
      context?.researcher_labels,
      context?.patterns,
    );
    if (!signal) continue;
    const line = `FL contrib $${hit.amount ?? '?'} to ${hit.committee_name} (${hit.contribution_date ?? '?'}) — ${signal.reason}`;
    evidence.push(line);
    if (!best || signal.confidence > best.confidence) {
      best = { lean: signal.lean, confidence: signal.confidence };
    }
  }

  if (context?.layer === 2 && context.entity_name) {
    evidence.unshift(`Layer 2: contribution under entity "${context.entity_name}"`);
  }

  if (!best) {
    return {
      lean: 'Undetermined',
      confidence: 0,
      lean_signals_found: false,
      evidence,
    };
  }

  return {
    lean: best.lean,
    confidence: best.confidence,
    lean_signals_found: true,
    evidence,
  };
}