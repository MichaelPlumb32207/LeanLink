import type { LeanLabel } from '@/lib/enrichment/types';
import type { FlContributionHit } from '@/lib/fl-contrib/types';

export interface FlDonationLeanResult {
  lean: LeanLabel;
  confidence: number;
  lean_signals_found: boolean;
  evidence: string[];
}

const RIGHT_PATTERNS: { pattern: RegExp; confidence: number; label: string }[] = [
  { pattern: /\brepublican\b/i, confidence: 85, label: 'Republican committee/candidate' },
  { pattern: /\b(?:rpo|rpoa|republican party of florida)\b/i, confidence: 88, label: 'Republican Party of Florida' },
  { pattern: /\bwinred\b/i, confidence: 90, label: 'WinRed conduit' },
  { pattern: /\bgop\b/i, confidence: 85, label: 'GOP' },
  { pattern: /\bconservative\b/i, confidence: 70, label: 'Conservative committee' },
];

const LEFT_PATTERNS: { pattern: RegExp; confidence: number; label: string }[] = [
  { pattern: /\bdemocrat(ic)?\b/i, confidence: 85, label: 'Democratic committee/candidate' },
  { pattern: /\b(?:fdp|florida democratic)\b/i, confidence: 88, label: 'Florida Democratic Party' },
  { pattern: /\bactblue\b/i, confidence: 90, label: 'ActBlue conduit' },
  { pattern: /\bprogressive\b/i, confidence: 72, label: 'Progressive committee' },
];

function inferFromCommittee(committee: string | null): {
  lean: LeanLabel;
  confidence: number;
  reason: string;
} | null {
  if (!committee?.trim()) return null;
  for (const { pattern, confidence, label } of RIGHT_PATTERNS) {
    if (pattern.test(committee)) return { lean: 'Right', confidence, reason: label };
  }
  for (const { pattern, confidence, label } of LEFT_PATTERNS) {
    if (pattern.test(committee)) return { lean: 'Left', confidence, reason: label };
  }
  return null;
}

export function inferLeanFromFlContributions(
  hits: FlContributionHit[],
  context?: { layer?: 1 | 2; entity_name?: string },
): FlDonationLeanResult {
  const evidence: string[] = [];
  let best: { lean: LeanLabel; confidence: number } | null = null;

  for (const hit of hits) {
    const signal = inferFromCommittee(hit.committee_name);
    if (!signal) continue;
    const line = `FL contrib $${hit.amount ?? '?'} to ${hit.committee_name} (${hit.contribution_date ?? '?'})`;
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