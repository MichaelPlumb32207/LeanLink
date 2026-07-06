import { committeeNameNorm } from '@/lib/committee-lean/normalize';
import type { LeanLabel } from '@/lib/enrichment/types';

export interface CommitteeLeanSignal {
  lean: LeanLabel;
  confidence: number;
  reason: string;
  source: 'pattern' | 'researcher';
}

const RIGHT_PATTERNS: { pattern: RegExp; confidence: number; label: string }[] = [
  { pattern: /\brepublican\b/i, confidence: 85, label: 'Republican committee/candidate' },
  { pattern: /\b(?:rpo|rpoa|republican party of florida)\b/i, confidence: 88, label: 'Republican Party of Florida' },
  { pattern: /\bwinred\b/i, confidence: 90, label: 'WinRed conduit' },
  { pattern: /\bgop\b/i, confidence: 85, label: 'GOP' },
  { pattern: /\bconservative\b/i, confidence: 70, label: 'Conservative committee' },
  // No \b before \( — a word boundary needs a word char adjacent, and both the
  // space and the paren are non-word, so \b\(rep\) can never match (DEF-005/006).
  { pattern: /\(rep\)/i, confidence: 82, label: 'FL recipient (REP)' },
  { pattern: /\(pty\).*republican/i, confidence: 88, label: 'Republican party committee (PTY)' },
  { pattern: /\bflorida house republican\b/i, confidence: 85, label: 'Florida House Republican' },
  { pattern: /\btrump\b/i, confidence: 88, label: 'Trump-affiliated recipient' },
];

const LEFT_PATTERNS: { pattern: RegExp; confidence: number; label: string }[] = [
  { pattern: /\bdemocrat(ic)?\b/i, confidence: 85, label: 'Democratic committee/candidate' },
  { pattern: /\b(?:fdp|florida democratic)\b/i, confidence: 88, label: 'Florida Democratic Party' },
  { pattern: /\bactblue\b/i, confidence: 90, label: 'ActBlue conduit' },
  { pattern: /\bprogressive\b/i, confidence: 72, label: 'Progressive committee' },
  { pattern: /\(dem\)/i, confidence: 82, label: 'FL recipient (DEM)' },
  { pattern: /\b(?:dnc|democratic national)\b/i, confidence: 85, label: 'DNC' },
  { pattern: /\bbiden\b/i, confidence: 82, label: 'Biden-affiliated' },
];

export type ResearcherCommitteeLabel = {
  committee_name_norm: string;
  lean: LeanLabel;
  confidence: number;
  notes?: string | null;
};

export function inferLeanFromCommitteeName(
  committee: string | null | undefined,
  researcherLabels?: Map<string, ResearcherCommitteeLabel>,
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

  for (const { pattern, confidence, label } of RIGHT_PATTERNS) {
    if (pattern.test(committee)) return { lean: 'Right', confidence, reason: label, source: 'pattern' };
  }
  for (const { pattern, confidence, label } of LEFT_PATTERNS) {
    if (pattern.test(committee)) return { lean: 'Left', confidence, reason: label, source: 'pattern' };
  }
  return null;
}

export function unresolvedCommitteeNames(
  committees: string[],
  researcherLabels?: Map<string, ResearcherCommitteeLabel>,
): string[] {
  return committees.filter((c) => !inferLeanFromCommitteeName(c, researcherLabels));
}