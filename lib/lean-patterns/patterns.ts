/**
 * Lean-pattern registry — pure module (no pg import; committee-lean/infer.ts
 * reaches the client bundle). THE single source for lean patterns (ENH-008,
 * D-031): the two scanners forked once and both copies carried the same bug
 * for months (DEF-005/006). Never re-hardcode patterns in a scanner.
 *
 * FALLBACK_LEAN_PATTERN_ROWS mirrors migrations/019_lean_patterns.sql
 * byte-for-byte, per scope, in each scanner's original order —
 * scripts/smoke-golden-voters.ts asserts parity; edit BOTH or it fails.
 * Scopes stay separate because scan order encodes behavior ("WINRED REPUBLICAN
 * FUND": fec order → WinRed/90, fl order → Republican/85).
 */
import type { LeanLabel } from '@/lib/enrichment/types';

export type LeanPatternScope = 'fec' | 'fl' | 'both';

export interface LeanPatternRow {
  scope: LeanPatternScope;
  pattern: string;
  flags: string;
  lean: LeanLabel;
  confidence: number;
  label: string;
  sort_order: number;
}

export interface CompiledLeanPattern {
  regex: RegExp;
  lean: LeanLabel;
  confidence: number;
  label: string;
}

export interface LeanPatternSets {
  fec: CompiledLeanPattern[];
  fl: CompiledLeanPattern[];
  meta: { source: 'db' | 'fallback'; rowCount: number; invalidCount: number };
}

const r = String.raw;

export const FALLBACK_LEAN_PATTERN_ROWS: LeanPatternRow[] = [
  // fec scope — Right block
  { scope: 'fec', pattern: r`\bwinred\b`, flags: 'i', lean: 'Right', confidence: 90, label: 'WinRed conduit', sort_order: 10 },
  { scope: 'fec', pattern: r`\btrump\b`, flags: 'i', lean: 'Right', confidence: 88, label: 'Trump-affiliated recipient', sort_order: 20 },
  { scope: 'fec', pattern: r`\brepublican\b`, flags: 'i', lean: 'Right', confidence: 85, label: 'Republican committee/candidate', sort_order: 30 },
  { scope: 'fec', pattern: r`\bkatherine\s+harris\b`, flags: 'i', lean: 'Right', confidence: 88, label: 'Katherine Harris (R)', sort_order: 40 },
  { scope: 'fec', pattern: r`\b(?:rnc|gop)\b`, flags: 'i', lean: 'Right', confidence: 85, label: 'RNC/GOP', sort_order: 50 },
  { scope: 'fec', pattern: r`\bmaga\b`, flags: 'i', lean: 'Right', confidence: 82, label: 'MAGA-affiliated', sort_order: 60 },
  { scope: 'fec', pattern: r`\bconservative\b`, flags: 'i', lean: 'Right', confidence: 70, label: 'Conservative committee', sort_order: 70 },
  { scope: 'fec', pattern: r`\bliberty\b`, flags: 'i', lean: 'Right', confidence: 65, label: 'Liberty-oriented PAC', sort_order: 80 },
  { scope: 'fec', pattern: r`\(rep\)`, flags: 'i', lean: 'Right', confidence: 82, label: 'recipient party code (REP)', sort_order: 90 },
  // fec scope — Left block
  { scope: 'fec', pattern: r`\bactblue\b`, flags: 'i', lean: 'Left', confidence: 90, label: 'ActBlue conduit', sort_order: 110 },
  { scope: 'fec', pattern: r`\bdemocrat(ic)?\b`, flags: 'i', lean: 'Left', confidence: 85, label: 'Democratic committee/candidate', sort_order: 120 },
  { scope: 'fec', pattern: r`\b(?:dnc|democratic national)\b`, flags: 'i', lean: 'Left', confidence: 85, label: 'DNC', sort_order: 130 },
  { scope: 'fec', pattern: r`\bbiden\b`, flags: 'i', lean: 'Left', confidence: 82, label: 'Biden-affiliated', sort_order: 140 },
  { scope: 'fec', pattern: r`\b(?:kamala\s+)?harris\s+(?:for|2024)\b`, flags: 'i', lean: 'Left', confidence: 80, label: 'Harris campaign', sort_order: 150 },
  { scope: 'fec', pattern: r`\bprogressive\b`, flags: 'i', lean: 'Left', confidence: 72, label: 'Progressive committee', sort_order: 160 },
  { scope: 'fec', pattern: r`\b(?:emily'?s list|moveon)\b`, flags: 'i', lean: 'Left', confidence: 78, label: 'Progressive advocacy PAC', sort_order: 170 },
  { scope: 'fec', pattern: r`\(dem\)`, flags: 'i', lean: 'Left', confidence: 82, label: 'recipient party code (DEM)', sort_order: 180 },
  { scope: 'fec', pattern: r`\(dfl\)`, flags: 'i', lean: 'Left', confidence: 82, label: 'recipient party code (DFL — Democratic affiliate)', sort_order: 190 },
  // fec scope — Neutral block
  { scope: 'fec', pattern: r`\b(?:bipartisan|nonpartisan|independent)\b`, flags: 'i', lean: 'Independent', confidence: 55, label: 'Nonpartisan committee', sort_order: 300 },
  // fl scope — Right block
  { scope: 'fl', pattern: r`\brepublican\b`, flags: 'i', lean: 'Right', confidence: 85, label: 'Republican committee/candidate', sort_order: 10 },
  { scope: 'fl', pattern: r`\b(?:rpo|rpoa|republican party of florida)\b`, flags: 'i', lean: 'Right', confidence: 88, label: 'Republican Party of Florida', sort_order: 20 },
  { scope: 'fl', pattern: r`\bwinred\b`, flags: 'i', lean: 'Right', confidence: 90, label: 'WinRed conduit', sort_order: 30 },
  { scope: 'fl', pattern: r`\bgop\b`, flags: 'i', lean: 'Right', confidence: 85, label: 'GOP', sort_order: 40 },
  { scope: 'fl', pattern: r`\bconservative\b`, flags: 'i', lean: 'Right', confidence: 70, label: 'Conservative committee', sort_order: 50 },
  { scope: 'fl', pattern: r`\(rep\)`, flags: 'i', lean: 'Right', confidence: 82, label: 'FL recipient (REP)', sort_order: 60 },
  { scope: 'fl', pattern: r`\(pty\).*republican`, flags: 'i', lean: 'Right', confidence: 88, label: 'Republican party committee (PTY)', sort_order: 70 },
  { scope: 'fl', pattern: r`\bflorida house republican\b`, flags: 'i', lean: 'Right', confidence: 85, label: 'Florida House Republican', sort_order: 80 },
  { scope: 'fl', pattern: r`\btrump\b`, flags: 'i', lean: 'Right', confidence: 88, label: 'Trump-affiliated recipient', sort_order: 90 },
  // fl scope — Left block
  { scope: 'fl', pattern: r`\bdemocrat(ic)?\b`, flags: 'i', lean: 'Left', confidence: 85, label: 'Democratic committee/candidate', sort_order: 110 },
  { scope: 'fl', pattern: r`\b(?:fdp|florida democratic)\b`, flags: 'i', lean: 'Left', confidence: 88, label: 'Florida Democratic Party', sort_order: 120 },
  { scope: 'fl', pattern: r`\bactblue\b`, flags: 'i', lean: 'Left', confidence: 90, label: 'ActBlue conduit', sort_order: 130 },
  { scope: 'fl', pattern: r`\bprogressive\b`, flags: 'i', lean: 'Left', confidence: 72, label: 'Progressive committee', sort_order: 140 },
  { scope: 'fl', pattern: r`\(dem\)`, flags: 'i', lean: 'Left', confidence: 82, label: 'FL recipient (DEM)', sort_order: 150 },
  { scope: 'fl', pattern: r`\b(?:dnc|democratic national)\b`, flags: 'i', lean: 'Left', confidence: 85, label: 'DNC', sort_order: 160 },
  { scope: 'fl', pattern: r`\bbiden\b`, flags: 'i', lean: 'Left', confidence: 82, label: 'Biden-affiliated', sort_order: 170 },
];

export function compileLeanPatternRows(
  rows: LeanPatternRow[],
  source: 'db' | 'fallback',
): LeanPatternSets {
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  const sets: LeanPatternSets = {
    fec: [],
    fl: [],
    meta: { source, rowCount: rows.length, invalidCount: 0 },
  };
  for (const row of sorted) {
    let regex: RegExp;
    try {
      regex = new RegExp(row.pattern, row.flags);
    } catch {
      // Bad regex from the DB must never take down a run boundary.
      console.warn(`lean_patterns: invalid pattern skipped: ${row.pattern}`);
      sets.meta.invalidCount += 1;
      continue;
    }
    const compiled: CompiledLeanPattern = {
      regex,
      lean: row.lean,
      confidence: row.confidence,
      label: row.label,
    };
    if (row.scope === 'fec' || row.scope === 'both') sets.fec.push(compiled);
    if (row.scope === 'fl' || row.scope === 'both') sets.fl.push(compiled);
  }
  return sets;
}

let fallbackMemo: LeanPatternSets | null = null;

/** Compiled form of today's hardcoded lists — the default when no DB registry. */
export function getFallbackLeanPatterns(): LeanPatternSets {
  if (!fallbackMemo) {
    fallbackMemo = compileLeanPatternRows(FALLBACK_LEAN_PATTERN_ROWS, 'fallback');
  }
  return fallbackMemo;
}

export interface LeanPatternMatch {
  lean: LeanLabel;
  confidence: number;
  label: string;
}

/** First match wins — list order IS the precedence (Right → Left → Neutral). */
export function scanLeanPatterns(
  text: string,
  list: CompiledLeanPattern[],
): LeanPatternMatch | null {
  for (const { regex, lean, confidence, label } of list) {
    if (regex.test(text)) return { lean, confidence, label };
  }
  return null;
}
