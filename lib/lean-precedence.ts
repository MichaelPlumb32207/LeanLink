/**
 * How to resolve deliverable lean when registration party and public-money
 * (fusion) evidence disagree.
 *
 * Default: **wallet** — donation/public-evidence lean wins (owner preference:
 * "they lean the way their wallet leans"). Overridable per upload (and later
 * per account). See D-044.
 */
import type { LeanLabel } from '@/lib/enrichment/types';

export type LeanPrecedenceMode = 'wallet' | 'registration' | 'conflict_undetermined';

export const LEAN_PRECEDENCE_OPTIONS: {
  id: LeanPrecedenceMode;
  label: string;
  description: string;
}[] = [
  {
    id: 'wallet',
    label: 'Wallet wins (default)',
    description:
      'Public donation / evidence lean overrides registration party when both exist.',
  },
  {
    id: 'registration',
    label: 'Registration wins',
    description: 'Party on the roll wins; donations are evidence notes only when they conflict.',
  },
  {
    id: 'conflict_undetermined',
    label: 'Conflict → Undetermined',
    description:
      'If party and evidence disagree, withhold lean (research integrity / human review).',
  },
];

export const DEFAULT_LEAN_PRECEDENCE: LeanPrecedenceMode = 'wallet';

export function parseLeanPrecedence(raw: unknown): LeanPrecedenceMode {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'registration' || s === 'reg' || s === 'party') return 'registration';
  if (s === 'conflict_undetermined' || s === 'conflict' || s === 'undetermined') {
    return 'conflict_undetermined';
  }
  return 'wallet';
}

/** Party field → lean prior (null if NPA/minor/unknown). */
export function leanFromRegistrationParty(party: string | null | undefined): LeanLabel | null {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'DEM') return 'Left';
  if (p === 'REP') return 'Right';
  return null;
}

export function isDeterminateLean(lean: string | null | undefined): lean is LeanLabel {
  return lean === 'Left' || lean === 'Right' || lean === 'Independent';
}

export interface LeanResolutionInput {
  party: string | null | undefined;
  /** Fused / settled lean from evidence arms (FEC, FL, …). */
  evidenceLean: string | null | undefined;
  evidenceConfidence?: number | null;
  /** Confidence to use when falling back to registration-only prior. */
  registrationConfidence?: number;
  precedence?: LeanPrecedenceMode;
}

export interface LeanResolution {
  lean: LeanLabel;
  confidence: number;
  /** Client-safe short reason (D-042 layer 1–2). */
  reason: string;
  /** true when party prior and evidence lean both exist and disagree. */
  tension: boolean;
  /** Which signal drove the deliverable lean. */
  winner: 'wallet' | 'registration' | 'none' | 'conflict';
  registrationLean: LeanLabel | null;
  evidenceLean: LeanLabel | null;
}

/**
 * Resolve client-facing lean under the configured precedence.
 * Does not mutate fusion/evidence — export/presentation only.
 */
export function resolveDeliverableLean(input: LeanResolutionInput): LeanResolution {
  const mode = input.precedence ?? DEFAULT_LEAN_PRECEDENCE;
  const reg = leanFromRegistrationParty(input.party);
  const ev = isDeterminateLean(input.evidenceLean) ? input.evidenceLean : null;
  const evConf = Math.max(0, Math.min(100, Number(input.evidenceConfidence ?? 0)));
  const regConf = Math.max(
    0,
    Math.min(100, Number(input.registrationConfidence ?? 72)),
  );

  const tension = Boolean(reg && ev && reg !== ev);

  if (!reg && !ev) {
    return {
      lean: 'Undetermined',
      confidence: 0,
      reason: 'No party prior and no public-evidence lean',
      tension: false,
      winner: 'none',
      registrationLean: null,
      evidenceLean: null,
    };
  }

  if (reg && !ev) {
    return {
      lean: reg,
      confidence: regConf,
      reason: 'Registration party prior (no public-evidence lean yet)',
      tension: false,
      winner: 'registration',
      registrationLean: reg,
      evidenceLean: null,
    };
  }

  if (ev && !reg) {
    return {
      lean: ev,
      confidence: evConf || 60,
      reason: 'Public-evidence lean (no major-party registration prior)',
      tension: false,
      winner: 'wallet',
      registrationLean: null,
      evidenceLean: ev,
    };
  }

  // Both present
  if (!tension) {
    // Agree (or Independent vs party — treat Independent as evidence path)
    if (ev === reg) {
      return {
        lean: ev!,
        confidence: Math.max(evConf, regConf),
        reason: 'Registration party and public evidence agree',
        tension: false,
        winner: 'wallet',
        registrationLean: reg,
        evidenceLean: ev,
      };
    }
    // Independent evidence + DEM/REP party — still "tension" for Independent≠Left/Right
    // handled above as tension true when reg !== ev
  }

  // Disagreement
  if (mode === 'wallet') {
    return {
      lean: ev!,
      confidence: evConf || 60,
      reason: `Wallet/evidence overrides registration (${reg} → ${ev})`,
      tension: true,
      winner: 'wallet',
      registrationLean: reg,
      evidenceLean: ev,
    };
  }

  if (mode === 'registration') {
    return {
      lean: reg!,
      confidence: regConf,
      reason: `Registration party kept; evidence noted as conflicting (${ev})`,
      tension: true,
      winner: 'registration',
      registrationLean: reg,
      evidenceLean: ev,
    };
  }

  // conflict_undetermined
  return {
    lean: 'Undetermined',
    confidence: Math.min(40, Math.max(evConf, regConf)),
    reason: `Conflict withheld: registration ${reg} vs evidence ${ev}`,
    tension: true,
    winner: 'conflict',
    registrationLean: reg,
    evidenceLean: ev,
  };
}
