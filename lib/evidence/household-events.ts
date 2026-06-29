import type { AnchorProfile } from '@/lib/anchor/profile';
import type { EvidenceEventInput } from '@/lib/evidence/types';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

const DEDUPE_KEY = 'anchor_profile_v1';

export function buildHouseholdEvidenceEvent(params: {
  upload_id: string;
  voter_record_id: string;
  user_id: string;
  voter: ParsedFlVoterRecord;
  profile: AnchorProfile;
}): EvidenceEventInput | null {
  const { profile } = params;
  const hasHousehold = profile.household_members.length > 0;
  const hasVariants = profile.name_variants.length > 1;
  if (!hasHousehold && !hasVariants) return null;

  const evidence: string[] = [];
  if (hasVariants) {
    const alt = profile.name_variants
      .filter((v) => v.source !== 'canonical')
      .map((v) => `${v.full_name} (${v.note})`)
      .slice(0, 4);
    if (alt.length) {
      evidence.push(`Alternate search names: ${alt.join('; ')}`);
    }
  }
  if (hasHousehold) {
    for (const m of profile.household_members.slice(0, 6)) {
      evidence.push(
        `Co-resident row ${m.row_index}: ${m.name_full} (${m.party}) — same address on file`,
      );
    }
    if (profile.household_members.length > 6) {
      evidence.push(`…and ${profile.household_members.length - 6} more co-resident(s)`);
    }
  }
  for (const note of profile.notes) {
    if (!evidence.includes(note)) evidence.push(note);
  }

  return {
    upload_id: params.upload_id,
    voter_record_id: params.voter_record_id,
    user_id: params.user_id,
    arm: 'household',
    source: 'anchor_profile',
    identity_band: hasHousehold ? 'probable' : 'none',
    identity_score: hasHousehold ? 0.6 : null,
    probable_same_person: false,
    lean_signal: 'Undetermined',
    lean_confidence: null,
    evidence,
    urls: [],
    payload: {
      dedupe_key: DEDUPE_KEY,
      name_variants: profile.name_variants,
      household_members: profile.household_members,
      fec_query_names: profile.fec_query_names,
    },
    cost_usd: 0,
    dedupe_key: DEDUPE_KEY,
  };
}