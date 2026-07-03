/**
 * Intake data-completeness score.
 *
 * Given a normalized voter record, estimate how much signal the client gave us:
 * which arms can realistically run, and the confidence band to expect. This
 * (a) guides the client/operator toward records worth pursuing, (b) can gate
 * which arms are worth running, and (c) can later scale the baseline fee.
 *
 * Thin data → thin results: the score is honest about it up front rather than
 * surfacing false confidence after the fact.
 */
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export type CompletenessBand = 'thin' | 'moderate' | 'rich';

/** Which arms a record can meaningfully attempt, given the fields present. */
export interface ReachableArms {
  fec: boolean; // needs name + state; city/zip sharpen it
  fl_contrib: boolean; // needs name + street address
  sunbiz: boolean; // needs name + street address
  osint: boolean; // always attemptable (paid), better with dob/email/phone
}

export interface CompletenessResult {
  score: number; // 0–100
  band: CompletenessBand;
  reachable: ReachableArms;
  missing_high_value: string[]; // fields that, if added, would most improve results
  note: string;
}

/**
 * Per-field weights. Address is the highest-leverage field (unlocks FL/Sunbiz
 * and disambiguates FEC). Employer sharpens FEC. DoB/email/phone mainly help
 * OSINT + operator tiebreak. Party is a cheap prior. Voter ID enables future
 * FL-file resolution.
 */
const WEIGHTS = {
  streetAddress: 30,
  cityZip: 18, // city+zip when no street
  county: 6,
  employer: 12,
  dob: 8,
  email: 8,
  phone: 6,
  party: 6,
  voterId: 6,
} as const;

function has(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

export function scoreCompleteness(record: ParsedFlVoterRecord): CompletenessResult {
  const street = has(record.residence.line1);
  const city = has(record.residence.city);
  const zip = has(record.residence.zip);
  const county = has(record.countyCode);
  const employer = has(record.employer);
  const dob = has(record.birthDate);
  const email = has(record.email);
  const phone = has(record.phone);
  const party = has(record.party);
  const voterId = has(record.voterId);

  let score = 0;
  if (street) score += WEIGHTS.streetAddress;
  else if (city && zip) score += WEIGHTS.cityZip;
  if (county) score += WEIGHTS.county;
  if (employer) score += WEIGHTS.employer;
  if (dob) score += WEIGHTS.dob;
  if (email) score += WEIGHTS.email;
  if (phone) score += WEIGHTS.phone;
  if (party) score += WEIGHTS.party;
  if (voterId) score += WEIGHTS.voterId;
  score = Math.min(100, score);

  const reachable: ReachableArms = {
    fec: true, // name + state always present past the anchor gate
    fl_contrib: street,
    sunbiz: street,
    osint: true,
  };

  const band: CompletenessBand = score >= 55 ? 'rich' : score >= 25 ? 'moderate' : 'thin';

  const missing_high_value: string[] = [];
  if (!street) missing_high_value.push('street address');
  if (!employer) missing_high_value.push('employer/occupation');
  if (!dob) missing_high_value.push('date of birth');
  if (!email && !phone) missing_high_value.push('email or phone');

  const note =
    band === 'thin'
      ? 'Thin data — expect lower hit-rate; likely only OSINT can reach this record.'
      : band === 'moderate'
        ? 'Moderate data — FEC and (with a street address) FL/Sunbiz are feasible.'
        : 'Rich data — all arms feasible with good disambiguation.';

  return { score, band, reachable, missing_high_value, note };
}
