import type { FecContributionHit, FecMatchLevel } from '@/lib/fec/contributor-lookup';
import { inferLeanFromDonations } from '@/lib/fec/donation-lean';
import {
  scoreFecContributionsAgainstVoter,
  type FecIdentityMatchResult,
} from '@/lib/fec/identity-match';
import type { DonationLeanResult } from '@/lib/fec/donation-lean';
import type { LeanLabel } from '@/lib/enrichment/types';
import type { ParsedFlVoterRecord } from '@/lib/fl-voter-registration';

export interface FecScoredLookupResult {
  identity: FecIdentityMatchResult;
  donation_lean: DonationLeanResult | null;
  fec_lean: LeanLabel | null;
  fec_lean_confidence: number | null;
}

export function scoreFecLookupForVoter(params: {
  voter: ParsedFlVoterRecord;
  contributions: FecContributionHit[];
  matchLevel: FecMatchLevel | 'none';
}): FecScoredLookupResult {
  const identity = scoreFecContributionsAgainstVoter({
    voter: params.voter,
    contributions: params.contributions,
    matchLevel: params.matchLevel,
  });

  if (!params.contributions.length || !identity.probable_same_person) {
    return {
      identity,
      donation_lean: null,
      fec_lean: null,
      fec_lean_confidence: null,
    };
  }

  const donation_lean = inferLeanFromDonations(identity.contributions);
  const fec_lean = donation_lean.lean_signals_found ? donation_lean.lean : null;
  const fec_lean_confidence = donation_lean.lean_signals_found ? donation_lean.confidence : null;

  return {
    identity,
    donation_lean,
    fec_lean,
    fec_lean_confidence,
  };
}