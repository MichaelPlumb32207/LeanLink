/**
 * FL registration extract universe — who is kept at ingest.
 *
 * Research default: NPA + ACT only (lean-inference POC).
 * GOTV default: all parties + ACT + INA (mobilization universe).
 * Custom: multi-select parties and/or statuses.
 *
 * Stored on voter_uploads.ingest_universe (migration 021).
 */
import type {
  FlIngestFilter,
  FlPartyAffiliation,
  FlVoterStatus,
} from '@/lib/fl-voter-registration';
import {
  DEFAULT_LEANLINK_FILTER,
  GOTV_UNIVERSE_FILTER,
} from '@/lib/fl-voter-registration';

export type UniversePreset = 'npa-act' | 'gotv' | 'custom';

/** Snapshot persisted on the upload (and returned by APIs). */
export interface IngestUniverse {
  preset: UniversePreset;
  /** Empty / omit = no party filter (any party). */
  parties: FlPartyAffiliation[] | null;
  /** Empty / omit = no status filter (any status). */
  statuses: FlVoterStatus[] | null;
  exclude_exempt: boolean;
  exclude_suppressed: boolean;
}

export const UNIVERSE_PRESETS: {
  id: UniversePreset;
  label: string;
  description: string;
}[] = [
  {
    id: 'npa-act',
    label: 'NPA lean research',
    description: 'No party affiliation + Active only — original lean-inference scope.',
  },
  {
    id: 'gotv',
    label: 'GOTV universe',
    description: 'All parties, Active + Inactive — mobilization / engagement list.',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Pick parties and registration statuses yourself.',
  },
];

/** Common party codes on the FL extract (multi-select UI). */
export const UNIVERSE_PARTY_OPTIONS: { code: FlPartyAffiliation; label: string }[] = [
  { code: 'NPA', label: 'NPA' },
  { code: 'DEM', label: 'DEM' },
  { code: 'REP', label: 'REP' },
  { code: 'IND', label: 'IND' },
];

export const UNIVERSE_STATUS_OPTIONS: { code: FlVoterStatus; label: string }[] = [
  { code: 'ACT', label: 'Active (ACT)' },
  { code: 'INA', label: 'Inactive (INA)' },
];

export function universeFromPreset(preset: UniversePreset): IngestUniverse {
  if (preset === 'gotv') {
    return {
      preset: 'gotv',
      parties: null,
      statuses: ['ACT', 'INA'],
      exclude_exempt: true,
      exclude_suppressed: true,
    };
  }
  if (preset === 'npa-act') {
    return {
      preset: 'npa-act',
      parties: ['NPA'],
      statuses: ['ACT'],
      exclude_exempt: true,
      exclude_suppressed: true,
    };
  }
  // custom empty shell — caller fills parties/statuses
  return {
    preset: 'custom',
    parties: ['NPA'],
    statuses: ['ACT'],
    exclude_exempt: true,
    exclude_suppressed: true,
  };
}

export function toFlIngestFilter(u: IngestUniverse): FlIngestFilter {
  return {
    party: undefined,
    parties: u.parties && u.parties.length > 0 ? u.parties : undefined,
    status: undefined,
    statuses: u.statuses && u.statuses.length > 0 ? u.statuses : undefined,
    excludeExempt: u.exclude_exempt,
    excludeSuppressed: u.exclude_suppressed,
  };
}

export function filterFromUniverseOrDefault(
  u: IngestUniverse | null | undefined,
): FlIngestFilter {
  if (!u) return DEFAULT_LEANLINK_FILTER;
  return toFlIngestFilter(u);
}

/** Parse form/query body into a universe snapshot. */
export function parseUniverseInput(raw: {
  preset?: string | null;
  parties?: string | string[] | null;
  statuses?: string | string[] | null;
}): IngestUniverse {
  const presetRaw = (raw.preset ?? 'npa-act').toLowerCase().trim();
  const preset: UniversePreset =
    presetRaw === 'gotv' || presetRaw === 'custom' || presetRaw === 'npa-act'
      ? presetRaw
      : 'npa-act';

  if (preset === 'npa-act' || preset === 'gotv') {
    return universeFromPreset(preset);
  }

  const parties = normalizeCodeList(raw.parties) as FlPartyAffiliation[];
  const statuses = normalizeCodeList(raw.statuses) as FlVoterStatus[];
  const validStatuses = statuses.filter((s) => s === 'ACT' || s === 'INA') as FlVoterStatus[];

  return {
    preset: 'custom',
    parties: parties.length > 0 ? parties : null,
    statuses: validStatuses.length > 0 ? validStatuses : ['ACT'],
    exclude_exempt: true,
    exclude_suppressed: true,
  };
}

function normalizeCodeList(v: string | string[] | null | undefined): string[] {
  if (v == null || v === '') return [];
  const parts = Array.isArray(v) ? v : String(v).split(/[,\s]+/);
  return [
    ...new Set(
      parts
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export function universeLabel(u: IngestUniverse | null | undefined): string {
  if (!u) return 'NPA + ACT (legacy default)';
  if (u.preset === 'gotv') return 'GOTV (all parties · ACT+INA)';
  if (u.preset === 'npa-act') return 'NPA lean research (NPA · ACT)';
  const p = u.parties?.length ? u.parties.join(',') : 'any party';
  const s = u.statuses?.length ? u.statuses.join(',') : 'any status';
  return `Custom (${p} · ${s})`;
}

/** CLI: --universe npa-act|gotv|custom + optional --parties / --statuses */
export function universeFromCliArgs(args: {
  universe?: string | null;
  parties?: string | null;
  statuses?: string | null;
}): IngestUniverse {
  const hasCustomLists = Boolean(args.parties || args.statuses);
  const presetHint = (args.universe ?? (hasCustomLists ? 'custom' : 'npa-act')).toLowerCase();

  if (presetHint === 'gotv' && !hasCustomLists) return universeFromPreset('gotv');
  if (presetHint === 'npa-act' && !hasCustomLists) return universeFromPreset('npa-act');

  return parseUniverseInput({
    preset: 'custom',
    parties: args.parties ?? (presetHint === 'gotv' ? null : 'NPA'),
    statuses: args.statuses ?? (presetHint === 'gotv' ? 'ACT,INA' : 'ACT'),
  });
}

/** Map historical uploads (no column) for display only. */
export function legacyUniverseGuess(filename: string | null | undefined): IngestUniverse {
  // Pre-021 FL extracts used DEFAULT_LEANLINK_FILTER
  void filename;
  return universeFromPreset('npa-act');
}

// Re-export filters for callers that only import this module
export { DEFAULT_LEANLINK_FILTER, GOTV_UNIVERSE_FILTER };
