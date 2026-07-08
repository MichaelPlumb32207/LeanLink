/**
 * Arm detail registry — pure, presentation-only metadata for the expandable
 * line-score panels (ENH-019 Phase 1). No fetches, no React, no numbers: live
 * funnel/run figures come from the BoxScoreInning + UploadEvidenceSummary the
 * panel already has. Copy here is the honest, measured framing from the
 * ENH-019 plan §6 copy deck — state what an arm does and what "good" looks
 * like, including arms whose good output is zero settles.
 *
 * The `{id}` token in a cliHint/cliOnly command is interpolated with the real
 * upload id at render time — never hardcode an id.
 */

export type ArmActionId =
  | 'match-fec-index'
  | 'match-fl-contrib'
  | 'match-sunbiz-entity'
  | 'open-committee-manager';

export interface ArmActionSpec {
  id: ArmActionId;
  label: string;
  kind: 'evidence-action' | 'modal';
  /** Inline eligibility guard; over it the panel renders the CLI hint, not the button. */
  maxEligibleInline?: number;
  /** County-scale command template ({id} → upload id). */
  cliHint?: string;
}

export interface ArmDetailSpec {
  /** Matches BoxScoreInning.arm. */
  arm: string;
  /** One-liner: what this arm is for. */
  role: string;
  /** 2–3 sentences, honest measured framing. */
  explainer: string;
  /** Sunbiz: low event counts are by design — panel shows the caveat. */
  hitOnly?: boolean;
  actions: ArmActionSpec[];
  /** FEC: where fresh data actually comes from (bulk-snapshot reload, not a live sweep). */
  freshnessNote?: string;
  /** OSINT: no run button ever — show the command + verdict only. */
  cliOnly?: { command: string; note: string };
}

/** The three evidence actions share the same server-side 5,000-eligible guard. */
const INLINE_CAP = 5000;

export const ARM_DETAILS: Record<string, ArmDetailSpec> = {
  party_prior: {
    arm: 'party_prior',
    role: 'Party as provided at intake.',
    explainer:
      'Tier 0 is whatever lean the input file already carries. NPA extracts carry none by ' +
      'construction — this row exists so the waterfall’s starting point is explicit.',
    actions: [],
  },
  fec: {
    arm: 'fec',
    role: 'Federal donations — the primary settle arm.',
    explainer:
      'Matches voters against the local FEC bulk index across all loaded cycles; itemized ' +
      'receipts become auditable lean evidence. Committee labels (human > agent > pattern) ' +
      'decide the lean of each recipient. This is where most settles come from.',
    actions: [
      {
        id: 'match-fec-index',
        label: 'Match FEC (local index)',
        kind: 'evidence-action',
        maxEligibleInline: INLINE_CAP,
        cliHint: 'npx tsx scripts/run-fec-index.ts --upload-id {id} --concurrency 8',
      },
    ],
    // Freshness comes from loading a newer FEC bulk snapshot into Neon
    // (scripts/import-fec-indiv.ts) — NOT a live per-voter API sweep, which is
    // slow, rate-limited, and was never a prod path (owner decision 2026-07-08).
    freshnessNote:
      'Fresher data? Load a newer FEC bulk snapshot into Neon (scripts/import-fec-indiv.ts, SETUP §8a) — matching spans all loaded cycles, so a newer cycle is a pure additive hit-rate lift.',
  },
  fl_contrib: {
    arm: 'fl_contrib',
    role: 'Florida state contributions — person-name match.',
    explainer:
      'Matches voter names against FL campaign-finance contributors. Identity gating is strict ' +
      '(name + address corroboration), so expect heavy evidence and few settles — measured ' +
      '~0.005% settle on county scale. Its committee labels share the same namespace as FEC.',
    actions: [
      {
        id: 'match-fl-contrib',
        label: 'Match FL contributors (person)',
        kind: 'evidence-action',
        maxEligibleInline: INLINE_CAP,
        cliHint: 'npx tsx scripts/run-free-pass.ts --upload-id {id} --concurrency 8',
      },
      {
        id: 'open-committee-manager',
        label: 'Label committees',
        kind: 'modal',
      },
    ],
  },
  sunbiz: {
    arm: 'sunbiz',
    role: 'Business-officer identity enrichment.',
    explainer:
      'Finds voters who are corporate officers (Sunbiz), then bridges address-corroborated ' +
      'officers to their company’s state donations. The street-address hard gate means matches ' +
      'without a corroborated address can never settle — a completed run with zero settles is ' +
      'the arm working as designed, not failing.',
    hitOnly: true,
    actions: [
      {
        id: 'match-sunbiz-entity',
        label: 'Sunbiz → FL entity contributions',
        kind: 'evidence-action',
        maxEligibleInline: INLINE_CAP,
        cliHint: 'npx tsx scripts/run-free-pass.ts --upload-id {id} --concurrency 8',
      },
    ],
  },
  osint: {
    arm: 'osint',
    role: 'Public-expression OSINT — enrichment, not settle.',
    explainer:
      'A paid Grok pass over public political expression (endorsements, activism, self-ID). ' +
      'Measured yield on direct leans is near zero — its value is persona linkage on voters ' +
      'other arms already surfaced. Public sources only; no brokers, no logged-in scraping. ' +
      'Runs from the CLI under a hard dollar cap.',
    actions: [],
    cliOnly: {
      command: 'npx tsx scripts/run-osint-cohort.ts --upload {id} --dry-run',
      note: 'Always dry-run first; execution is owner-approved with --max-usd.',
    },
  },
};

/** Interpolate the {id} token in a CLI command template with a real upload id. */
export function fillCli(template: string, uploadId: string): string {
  return template.replace(/\{id\}/g, uploadId);
}
