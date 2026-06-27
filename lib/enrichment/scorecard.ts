import type { EnrichmentMode } from '@/lib/enrichment/modes';
import type { LeanLabel, OsintMatch, ResolutionStatus } from '@/lib/enrichment/types';
import { CALHOUN_SUGGESTED_TEST_ROWS } from '@/lib/enrichment/suggested-test-rows';

const SOCIAL_PLATFORMS = new Set([
  'x',
  'twitter',
  'linkedin',
  'facebook',
  'instagram',
  'social',
]);

export function isSocialPlatform(platform: string): boolean {
  return SOCIAL_PLATFORMS.has(platform.toLowerCase());
}

export function hasSocialFromMatches(matches: OsintMatch[]): boolean {
  return matches.some((m) => m.url && isSocialPlatform(m.platform));
}

export function hasSocialFromMatchedSocial(matchedSocial: string[]): boolean {
  return matchedSocial.length > 0;
}

export interface EnrichmentScorecardRow {
  rowIndex: number;
  scenario: string;
  note: string;
  voterRecordId: string | null;
  identity_resolution_status: ResolutionStatus | null;
  identity_best_match_score: number | null;
  social_found: boolean;
  lean: LeanLabel | null;
  lean_signals_found: boolean;
  cost_usd: number | null;
  web_search_calls: number | null;
  x_search_calls: number | null;
  error?: string;
}

export interface EnrichmentScorecardMetrics {
  identity_probable_pct: number;
  identity_ambiguous_pct: number;
  identity_none_pct: number;
  social_found_pct: number;
  lean_labeled_pct: number;
  lean_signals_pct: number;
  median_cost_usd: number | null;
  mean_cost_usd: number | null;
  total_cost_usd: number | null;
  extrapolated_cost_per_10k: number | null;
}

export interface EnrichmentScorecard {
  mode: EnrichmentMode;
  upload_id: string;
  row_count: number;
  completed: number;
  failed: number;
  metrics: EnrichmentScorecardMetrics;
  rows: EnrichmentScorecardRow[];
}

export function defaultScorecardRowIndices(): number[] {
  return CALHOUN_SUGGESTED_TEST_ROWS.map((r) => r.rowIndex);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

export function computeScorecardMetrics(
  rows: EnrichmentScorecardRow[],
): EnrichmentScorecardMetrics {
  const successful = rows.filter((r) => !r.error);
  const n = successful.length;
  const costs = successful
    .map((r) => r.cost_usd)
    .filter((c): c is number => typeof c === 'number' && !Number.isNaN(c));

  const medianCost = median(costs);
  const meanCost = mean(costs);

  return {
    identity_probable_pct: pct(
      successful.filter((r) => r.identity_resolution_status === 'probable').length,
      n,
    ),
    identity_ambiguous_pct: pct(
      successful.filter((r) => r.identity_resolution_status === 'ambiguous').length,
      n,
    ),
    identity_none_pct: pct(
      successful.filter((r) => r.identity_resolution_status === 'none').length,
      n,
    ),
    social_found_pct: pct(successful.filter((r) => r.social_found).length, n),
    lean_labeled_pct: pct(
      successful.filter((r) => r.lean && r.lean !== 'Undetermined').length,
      n,
    ),
    lean_signals_pct: pct(successful.filter((r) => r.lean_signals_found).length, n),
    median_cost_usd: medianCost,
    mean_cost_usd: meanCost,
    total_cost_usd: costs.length > 0 ? costs.reduce((s, c) => s + c, 0) : null,
    extrapolated_cost_per_10k:
      meanCost !== null ? Math.round(meanCost * 10_000 * 100) / 100 : null,
  };
}

export function buildScorecardRow(
  rowIndex: number,
  voterRecordId: string,
  result: {
    identity_resolution_status: ResolutionStatus;
    identity_best_match_score: number;
    identity_matches: OsintMatch[];
    lean_signals_found: boolean;
    lean: LeanLabel;
    matched_social: string[];
  },
  usage: {
    cost_usd?: number;
    web_search_calls?: number;
    x_search_calls?: number;
  } | null,
): EnrichmentScorecardRow {
  const meta = CALHOUN_SUGGESTED_TEST_ROWS.find((r) => r.rowIndex === rowIndex);
  const social_found =
    hasSocialFromMatchedSocial(result.matched_social) ||
    hasSocialFromMatches(result.identity_matches);

  return {
    rowIndex,
    scenario: meta?.scenario ?? `Row ${rowIndex}`,
    note: meta?.note ?? '',
    voterRecordId,
    identity_resolution_status: result.identity_resolution_status,
    identity_best_match_score: result.identity_best_match_score,
    social_found,
    lean: result.lean,
    lean_signals_found: result.lean_signals_found,
    cost_usd: typeof usage?.cost_usd === 'number' ? usage.cost_usd : null,
    web_search_calls:
      typeof usage?.web_search_calls === 'number' ? usage.web_search_calls : null,
    x_search_calls: typeof usage?.x_search_calls === 'number' ? usage.x_search_calls : null,
  };
}

export function buildFailedScorecardRow(rowIndex: number, error: string): EnrichmentScorecardRow {
  const meta = CALHOUN_SUGGESTED_TEST_ROWS.find((r) => r.rowIndex === rowIndex);
  return {
    rowIndex,
    scenario: meta?.scenario ?? `Row ${rowIndex}`,
    note: meta?.note ?? '',
    voterRecordId: null,
    identity_resolution_status: null,
    identity_best_match_score: null,
    social_found: false,
    lean: null,
    lean_signals_found: false,
    cost_usd: null,
    web_search_calls: null,
    x_search_calls: null,
    error,
  };
}