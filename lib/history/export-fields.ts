/**
 * Client-facing turnout / history columns for baseline deliverable export.
 * Pure: history_summary JSONB → flat string fields. Never invents ideology.
 */
import type { VotePattern, VoterHistorySummary } from '@/lib/fl-voter-history';

/** Appended after lean columns on the client deliverable (stable order). */
export const HISTORY_EXPORT_HEADERS = [
  'LeanLink Turnout Propensity',
  'LeanLink Turnout Score',
  'LeanLink Has History',
  'LeanLink Generals Voted',
  'LeanLink Generals On File',
  'LeanLink Primary Voter',
  'LeanLink Primary Count',
  'LeanLink Last Vote Date',
  'LeanLink Vote Pattern',
  'LeanLink Low Propensity',
  'LeanLink High Propensity',
  'LeanLink Presidential Years Only',
] as const;

export type HistoryExportHeader = (typeof HISTORY_EXPORT_HEADERS)[number];

const PATTERN_LABEL: Record<VotePattern, string> = {
  none: 'no_generals',
  presidential_years_only: 'presidential_years_only',
  midterm_years_only: 'midterm_years_only',
  multi_cycle: 'multi_cycle',
  unknown: 'unknown',
};

function resolvePattern(summary: VoterHistorySummary | null | undefined): VotePattern {
  if (!summary) return 'unknown';
  if (summary.vote_pattern) return summary.vote_pattern;
  // Pre-enhancement summaries: only safe defaults
  if (summary.general_elections_voted === 0) return 'none';
  return 'unknown';
}

/**
 * Map stored history_summary (or null) to export cells.
 * null / missing history → Has History = no; propensity blank (not "Low").
 */
export function historyExportValues(
  summary: VoterHistorySummary | null | undefined,
): Record<HistoryExportHeader, string> {
  const empty = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === '' ? '' : String(v);

  if (!summary || summary.total_events === 0) {
    // No history attach: distinguish from Low propensity with empty propensity
    // when summary is null; if summary exists with 0 events, still "Low" score 0.
    const noFile = !summary;
    return {
      'LeanLink Turnout Propensity': noFile ? '' : 'Low',
      'LeanLink Turnout Score': noFile ? '' : '0',
      'LeanLink Has History': 'no',
      'LeanLink Generals Voted': noFile ? '' : '0',
      'LeanLink Generals On File': noFile ? '' : empty(summary.general_elections_available),
      'LeanLink Primary Voter': 'no',
      'LeanLink Primary Count': '0',
      'LeanLink Last Vote Date': '',
      'LeanLink Vote Pattern': noFile ? 'unknown' : 'no_generals',
      'LeanLink Low Propensity': noFile ? '' : 'yes',
      'LeanLink High Propensity': 'no',
      'LeanLink Presidential Years Only': 'no',
    };
  }

  const pattern = resolvePattern(summary);
  const propensity = summary.turnout_propensity ?? '';
  const primaryCount = summary.primary_count ?? summary.primary_elections_voted ?? 0;

  return {
    'LeanLink Turnout Propensity': propensity,
    'LeanLink Turnout Score': empty(summary.turnout_score),
    'LeanLink Has History': 'yes',
    'LeanLink Generals Voted': empty(summary.general_elections_voted),
    'LeanLink Generals On File': empty(summary.general_elections_available),
    'LeanLink Primary Voter': primaryCount > 0 ? 'yes' : 'no',
    'LeanLink Primary Count': empty(primaryCount),
    'LeanLink Last Vote Date': summary.last_vote_date ?? '',
    'LeanLink Vote Pattern': PATTERN_LABEL[pattern],
    'LeanLink Low Propensity': propensity === 'Low' ? 'yes' : 'no',
    'LeanLink High Propensity': propensity === 'High' ? 'yes' : 'no',
    'LeanLink Presidential Years Only':
      pattern === 'presidential_years_only' ? 'yes' : 'no',
  };
}

export function historyExportRow(summary: VoterHistorySummary | null | undefined): string[] {
  const v = historyExportValues(summary);
  return HISTORY_EXPORT_HEADERS.map((h) => v[h]);
}
