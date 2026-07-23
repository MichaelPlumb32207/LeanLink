/**
 * Priority tiers for "who to go after" — pure rules on existing fields only.
 *
 * Inputs: party, registration status, history_summary, contact (email/phone).
 * Settled lean / fusion is optional (null on fresh GOTV loads until arms run).
 *
 * First matching tier wins (ordered). Side is the campaign we're ranking *for*
 * (DEM or REP). Opposite partisans are deprioritized, not deleted.
 */

export type CampaignSide = 'DEM' | 'REP';

export type PriorityTierId =
  | 'A_core_gotv'
  | 'B_inactive_chase'
  | 'C_npa_expand'
  | 'D_base_remind'
  | 'E_npa_soft'
  | 'F_other_party'
  | 'G_thin';

export interface PriorityTierDef {
  id: PriorityTierId;
  label: string;
  /** Campaign-facing one-liner */
  why: string;
  rank: number; // 1 = contact first
}

export const PRIORITY_TIERS: PriorityTierDef[] = [
  {
    id: 'A_core_gotv',
    label: 'A · Core GOTV',
    why: 'Your party, active, lower turnout, contactable — classic chase list',
    rank: 1,
  },
  {
    id: 'B_inactive_chase',
    label: 'B · Inactive chase',
    why: 'Your party but inactive registration — list-maintenance / re-engage',
    rank: 2,
  },
  {
    id: 'C_npa_expand',
    label: 'C · NPA expand',
    why: 'NPA, active, not high-turnout, contactable — persuasion / soft ID worth a touch',
    rank: 3,
  },
  {
    id: 'D_base_remind',
    label: 'D · Base remind',
    why: 'Your party, active, high turnout — cheaper reminder, not heavy persuasion',
    rank: 4,
  },
  {
    id: 'E_npa_soft',
    label: 'E · NPA soft',
    why: 'Other NPAs (thin contact or high turnout) — lower priority research pool',
    rank: 5,
  },
  {
    id: 'F_other_party',
    label: 'F · Other party',
    why: 'Registered with another party (or minor) — usually skip for partisan GOTV',
    rank: 6,
  },
  {
    id: 'G_thin',
    label: 'G · Thin / skip',
    why: 'Little to work with (no contact, no history, no side signal)',
    rank: 7,
  },
];

export interface PriorityInput {
  party: string;
  status: string;
  /** From history_summary.turnout_propensity when present */
  turnoutPropensity: 'High' | 'Medium' | 'Low' | null;
  hasEmail: boolean;
  hasPhone: boolean;
  hasHistory: boolean;
  /**
   * Optional settled/fused lean when arms have run.
   * 'Left' treated as DEM-aligned, 'Right' as REP-aligned for side match.
   */
  settledLean?: 'Left' | 'Right' | 'Independent' | 'Undetermined' | null;
}

export interface PriorityResult {
  tier: PriorityTierId;
  contactable: boolean;
  sideMatch: 'same' | 'opposite' | 'npa' | 'other';
  reasons: string[];
}

function normParty(p: string): string {
  return (p || '').trim().toUpperCase();
}

function sideFromLean(
  lean: PriorityInput['settledLean'],
): CampaignSide | null {
  if (lean === 'Left') return 'DEM';
  if (lean === 'Right') return 'REP';
  return null;
}

function classifySide(party: string, side: CampaignSide, lean?: PriorityInput['settledLean']): PriorityResult['sideMatch'] {
  const p = normParty(party);
  if (p === 'NPA' || p === '') {
    const fromLean = sideFromLean(lean ?? null);
    if (fromLean === side) return 'same';
    if (fromLean && fromLean !== side) return 'opposite';
    return 'npa';
  }
  if (p === side) return 'same';
  if (p === 'DEM' || p === 'REP') return 'opposite';
  return 'other';
}

export function assignPriorityTier(
  input: PriorityInput,
  side: CampaignSide,
): PriorityResult {
  const party = normParty(input.party);
  const status = (input.status || '').trim().toUpperCase();
  const contactable = input.hasEmail || input.hasPhone;
  const turnout = input.turnoutPropensity;
  const lowMed =
    turnout === 'Low' || turnout === 'Medium' || turnout === null; // null = unknown → treat as opportunity
  const high = turnout === 'High';
  const sideMatch = classifySide(party, side, input.settledLean);
  const reasons: string[] = [];

  // A · Core GOTV
  if (
    sideMatch === 'same' &&
    status === 'ACT' &&
    lowMed &&
    contactable &&
    party === side // registered same party (not lean-only same)
  ) {
    reasons.push('same_party', 'active', 'turnout_low_med_or_unknown', 'contactable');
    return { tier: 'A_core_gotv', contactable, sideMatch, reasons };
  }
  // Also: NPA with settled lean matching side + low/med + contact → treat as core expand
  if (
    sideMatch === 'same' &&
    party === 'NPA' &&
    status === 'ACT' &&
    lowMed &&
    contactable &&
    input.settledLean
  ) {
    reasons.push('npa_settled_lean_matches_side', 'active', 'contactable');
    return { tier: 'A_core_gotv', contactable, sideMatch, reasons };
  }

  // B · Inactive chase (your party)
  if (sideMatch === 'same' && status === 'INA' && (contactable || input.hasHistory)) {
    reasons.push('same_party_or_lean', 'inactive', contactable ? 'contactable' : 'has_history');
    return { tier: 'B_inactive_chase', contactable, sideMatch, reasons };
  }

  // C · NPA expand
  if (party === 'NPA' && status === 'ACT' && lowMed && contactable) {
    reasons.push('npa', 'active', 'turnout_low_med_or_unknown', 'contactable');
    return { tier: 'C_npa_expand', contactable, sideMatch, reasons };
  }

  // D · Base remind
  if (sideMatch === 'same' && status === 'ACT' && high) {
    reasons.push('same_party_or_lean', 'active', 'turnout_high');
    return { tier: 'D_base_remind', contactable, sideMatch, reasons };
  }

  // E · NPA soft (remaining NPA)
  if (party === 'NPA') {
    reasons.push('npa', 'lower_priority');
    return { tier: 'E_npa_soft', contactable, sideMatch, reasons };
  }

  // F · Other party (including opposite major)
  if (sideMatch === 'opposite' || sideMatch === 'other') {
    reasons.push(sideMatch === 'opposite' ? 'opposite_party' : 'minor_or_other_party');
    return { tier: 'F_other_party', contactable, sideMatch, reasons };
  }

  // G · Thin
  reasons.push('thin_or_unclassified');
  return { tier: 'G_thin', contactable, sideMatch, reasons };
}
