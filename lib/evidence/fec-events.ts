import { buildAnchorProfile } from '@/lib/anchor/profile';
import type { EvidenceEventInput } from '@/lib/evidence/types';
import type { FecScoredLookupResult } from '@/lib/fec/score-lookup-result';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

const MAX_RECEIPT_LINES = 5;

/**
 * Itemize a confirmed donor's receipts — the researcher must be able to see WHO
 * the money went to even (especially) when no lean is derivable from it.
 */
function confirmedReceiptLines(scored: FecScoredLookupResult): string[] {
  const confirmed = scored.identity.contributions.filter((c) => c.probable_same_person);
  const lines = confirmed.slice(0, MAX_RECEIPT_LINES).map((c) => {
    const amount =
      c.contribution.amount != null ? `$${c.contribution.amount.toLocaleString()}` : '$?';
    const recipient =
      c.contribution.committee_name ?? c.contribution.candidate_name ?? 'unknown recipient';
    const date = c.contribution.receipt_date ? ` · ${c.contribution.receipt_date}` : '';
    return `${amount} → ${recipient}${date}`;
  });
  if (confirmed.length > MAX_RECEIPT_LINES) {
    lines.push(`(+${confirmed.length - MAX_RECEIPT_LINES} more receipts)`);
  }
  return lines;
}

/** Structured mirror of the receipt lines for payload/audit export. */
function confirmedReceiptPayload(scored: FecScoredLookupResult) {
  return scored.identity.contributions
    .filter((c) => c.probable_same_person)
    .slice(0, MAX_RECEIPT_LINES)
    .map((c) => ({
      committee: c.contribution.committee_name,
      amount: c.contribution.amount,
      date: c.contribution.receipt_date,
      fec_url: c.contribution.fec_url,
    }));
}

/**
 * Evidence event for the LOCAL FEC index arm (bulk-loaded fec_contributions) —
 * same arm ('fec', tier 1) as the API sweep so fusion weighting, settlement,
 * and billing behave identically; distinct source/dedupe so a voter researched
 * by both paths keeps both records.
 */
export function buildFecIndexEvidenceEvent(params: {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  voter: ParsedFlVoterRecord;
  scored: FecScoredLookupResult;
  has_hits: boolean;
  names_tried: string[];
  snapshot_label: string;
}): EvidenceEventInput {
  const { scored, has_hits } = params;
  const top = scored.identity.contributions[0];
  const urls =
    scored.identity.contributions
      .filter((c) => c.probable_same_person && c.contribution.fec_url)
      .map((c) => c.contribution.fec_url as string)
      .slice(0, 5) ?? [];

  const evidence: string[] = [];
  if (!has_hits) {
    evidence.push(
      `FEC index (${params.snapshot_label}): no FL Schedule A rows for ${params.voter.name.full}.`,
    );
  } else if (!scored.identity.probable_same_person) {
    evidence.push(
      `FEC index (${params.snapshot_label}): ${scored.identity.contributions.length} row(s); identity band ${scored.identity.identity_band} (best score ${Math.round(scored.identity.best_score * 100)}%) — not confirmed for this voter.`,
    );
    if (top) {
      evidence.push(
        `Top hit: ${top.contribution.contributor_name ?? '?'} · ${top.contribution.contributor_city ?? '?'} ${top.contribution.contributor_zip ?? ''}`,
      );
    }
  } else {
    if (scored.donation_lean) evidence.push(...scored.donation_lean.evidence);
    evidence.push(...confirmedReceiptLines(scored));
  }

  return {
    upload_id: params.upload_id,
    voter_record_id: params.voter_record_id,
    user_id: params.user_id,
    arm: 'fec',
    source: 'fec_indiv_index',
    identity_band: scored.identity.identity_band,
    identity_score: scored.identity.best_score,
    probable_same_person: scored.identity.probable_same_person,
    lean_signal: scored.fec_lean,
    lean_confidence: scored.fec_lean_confidence,
    evidence,
    urls,
    payload: {
      dedupe_key: 'fec_indiv_index_v1',
      snapshot_label: params.snapshot_label,
      has_hits,
      hit_count: scored.identity.contributions.length,
      contributor_name: params.voter.name.full,
      names_tried: params.names_tried,
      receipts: confirmedReceiptPayload(scored),
    },
    cost_usd: 0,
    dedupe_key: 'fec_indiv_index_v1',
  };
}

export function buildFecSweepEvidenceEvent(params: {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  voter: ParsedFlVoterRecord;
  scored: FecScoredLookupResult;
  match_level: string;
  has_hits: boolean;
  sweep_job_id: string;
}): EvidenceEventInput {
  const { scored, has_hits } = params;
  const anchorProfile = buildAnchorProfile(params.voter, []);
  const top = scored.identity.contributions[0];
  const urls =
    scored.identity.contributions
      .filter((c) => c.probable_same_person && c.contribution.fec_url)
      .map((c) => c.contribution.fec_url as string)
      .slice(0, 5) ?? [];

  const evidence: string[] = [];
  if (!has_hits) {
    evidence.push(`FEC strict + state_only: no Schedule A rows for ${params.voter.name.full}.`);
  } else if (!scored.identity.probable_same_person) {
    evidence.push(
      `FEC ${params.match_level}: ${scored.identity.contributions.length} row(s) returned; identity band ${scored.identity.identity_band} (best score ${Math.round(scored.identity.best_score * 100)}%) — not confirmed for this voter.`,
    );
    if (top) {
      evidence.push(
        `Top hit: ${top.contribution.contributor_name ?? '?'} · ${top.contribution.contributor_city ?? '?'} ${top.contribution.contributor_zip ?? ''}`,
      );
    }
  } else {
    if (scored.donation_lean) evidence.push(...scored.donation_lean.evidence);
    evidence.push(...confirmedReceiptLines(scored));
  }

  return {
    upload_id: params.upload_id,
    voter_record_id: params.voter_record_id,
    user_id: params.user_id,
    arm: 'fec',
    source: 'fec_sweep',
    identity_band: scored.identity.identity_band,
    identity_score: scored.identity.best_score,
    probable_same_person: scored.identity.probable_same_person,
    lean_signal: scored.fec_lean,
    lean_confidence: scored.fec_lean_confidence,
    evidence,
    urls,
    payload: {
      dedupe_key: params.sweep_job_id,
      match_level: params.match_level,
      has_hits,
      contributor_name: params.voter.name.full,
      fec_query_names: anchorProfile.fec_query_names,
      receipts: confirmedReceiptPayload(scored),
    },
    cost_usd: 0,
    dedupe_key: params.sweep_job_id,
  };
}