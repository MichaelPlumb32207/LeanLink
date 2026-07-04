import type { LeanLabel } from '@/lib/enrichment/types';
import type { EvidenceEventInput } from '@/lib/evidence/types';

export const HUMAN_JUDGMENT_DEDUPE_KEY = 'street_view_review';

export interface HumanLeanGuessInput {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  lean: LeanLabel;
  note?: string;
  confidence?: number;
  address_used: string | null;
}

export function buildHumanJudgmentEvent(input: HumanLeanGuessInput): EvidenceEventInput {
  const confidence =
    input.lean === 'Undetermined'
      ? 0
      : Math.min(75, Math.max(25, input.confidence ?? 50));

  const evidence = [
    'Human researcher estimate (Street View / map review) — not automated inference.',
    input.lean === 'Undetermined'
      ? 'Researcher cleared estimate (no lean assigned).'
      : `Researcher lean: ${input.lean} (${confidence}% subjective confidence).`,
  ];
  if (input.note?.trim()) {
    evidence.push(`Note: ${input.note.trim()}`);
  }
  if (input.address_used) {
    evidence.push(`Address reviewed: ${input.address_used}`);
  }

  const urls: string[] = [];
  if (input.address_used) {
    urls.push(googleMapsSearchUrl(input.address_used));
    urls.push(googleStreetViewUrl(input.address_used));
  }

  return {
    upload_id: input.upload_id,
    voter_record_id: input.voter_record_id,
    user_id: input.user_id,
    arm: 'human_judgment',
    source: 'street_view_review',
    identity_band: null,
    identity_score: null,
    probable_same_person: true,
    lean_signal: input.lean,
    lean_confidence: input.lean === 'Undetermined' ? null : confidence,
    evidence,
    urls,
    payload: {
      method: 'street_view_review',
      judged_by: input.user_id,
      note: input.note?.trim() || null,
      address_used: input.address_used,
      subjective: true,
    },
    cost_usd: 0,
    dedupe_key: HUMAN_JUDGMENT_DEDUPE_KEY,
  };
}

export const LEAN_REVIEW_DEDUPE_KEY = 'lean_review';

export interface LeanReviewInput {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  action: 'accept' | 'reopen';
  lean: LeanLabel;
  confidence: number | null;
  contributing_arms: string[];
  note?: string;
}

/**
 * Audit-trail event for the researcher's accept/reopen decision on a fused
 * lean. Fusion ignores human_judgment events, so this never feeds the math —
 * the operative state is `voter_lean_fusion.review_status`; this records who
 * decided what, alongside the arm evidence it was based on.
 */
export function buildLeanReviewEvent(input: LeanReviewInput): EvidenceEventInput {
  const accepted = input.action === 'accept';
  const evidence = accepted
    ? [
        'Researcher accepted the fused lean as final (research closed for this voter).',
        `Accepted: ${input.lean} (${input.confidence ?? 0}% fused confidence) — contributing arms: ${
          input.contributing_arms.join(', ') || 'none'
        }.`,
      ]
    : ['Researcher reopened research (acceptance cleared).'];
  if (input.note?.trim()) evidence.push(`Note: ${input.note.trim()}`);

  return {
    upload_id: input.upload_id,
    voter_record_id: input.voter_record_id,
    user_id: input.user_id,
    arm: 'human_judgment',
    source: 'lean_review',
    identity_band: null,
    identity_score: null,
    probable_same_person: true,
    lean_signal: accepted ? input.lean : 'Undetermined',
    lean_confidence: accepted ? input.confidence : null,
    evidence,
    urls: [],
    payload: {
      method: 'lean_review',
      action: input.action,
      judged_by: input.user_id,
      note: input.note?.trim() || null,
      contributing_arms: input.contributing_arms,
    },
    cost_usd: 0,
    dedupe_key: LEAN_REVIEW_DEDUPE_KEY,
  };
}

export function googleMapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function googleStreetViewUrl(address: string): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&query=${encodeURIComponent(address)}`;
}